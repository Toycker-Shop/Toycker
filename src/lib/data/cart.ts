"use server"

import { cache } from "react"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  Cart,
  Order,
  ShippingOption,
  PaymentCollection,
  Promotion,
} from "@/lib/supabase/types"
import { revalidateTag, revalidatePath } from "next/cache"
import { getCartId, setCartId, removeCartId } from "./cookies"
export { removeCartId }
import { randomUUID } from "crypto"
import { redirect } from "next/navigation"
import { generatePayUHash, PayUHashParams } from "@/lib/payu"
import { generateEasebuzzHash, EasebuzzHashParams } from "@/lib/easebuzz"
import { getBaseURL } from "@/lib/util/env"
import { getAuthUser } from "./auth"
import { getCustomerFacingEmail } from "@/lib/util/customer-email"
import { INDIAN_PINCODE_ERROR, isValidIndianPincode } from "@/lib/util/indian-pincode"
import {
  getAppliedClubSavings,
  getOrderPricingMetadata,
  OrderPricingMetadata,
} from "@/lib/util/order-pricing"

import {
  mapCartItems,
  calculateCartTotals,
  CartShippingMethod,
  DatabaseCartItem,
  calculatePartialPaymentSplit,
  isFullOnlinePaymentProvider,
} from "@/lib/util/cart-calculations"
import {
  resolvePartialPaymentRule,
  type PartialPaymentRuleInput,
} from "@/lib/util/partial-payment-rules"

type CartWriteContext = {
  supabase:
    | Awaited<ReturnType<typeof createClient>>
    | Awaited<ReturnType<typeof createAdminClient>>
  userId: string | null
  email: string | null
}

type CustomerEmailProfileRow = {
  contact_email: string | null
  email: string | null
}

type CartShippingOptionRow = {
  id: string
  name: string
  amount: number
  min_order_free_shipping: number | null
}

type CartItemMetadataRow = {
  id: string
  quantity?: number | null
  metadata?: Record<string, unknown> | null
}

type CartOwnershipRow = {
  id: string
  user_id: string | null
  email: string | null
  updated_at: string | null
}

type CartMergeItemRow = {
  id: string
  cart_id: string
  product_id: string
  variant_id: string | null
  quantity: number | null
  metadata: Record<string, unknown> | null
}

type PartialPaymentProviderConfig = {
  partial_payment_percentage: number | null
}

type OrderCartMetadataRow = {
  metadata: Record<string, unknown> | null
}

type ActiveCartCandidateRow = {
  id: string
  updated_at: string | null
}

type CartItemGiftWrapRemovalRow = {
  id: string
  cart_id: string
  product_id: string
  metadata?: Record<string, unknown> | null
}

const metadataMatchesExactly = (
  itemMetadata: Record<string, unknown> | null | undefined,
  expectedMetadata: Record<string, unknown> | null | undefined
) => {
  const itemMeta = itemMetadata || {}
  const searchMeta = expectedMetadata || {}
  const itemKeys = Object.keys(itemMeta)
  const searchKeys = Object.keys(searchMeta)

  if (itemKeys.length !== searchKeys.length) return false

  return searchKeys.every((key) => itemMeta[key] === searchMeta[key])
}

const isGiftWrapLineMetadata = (
  metadata: Record<string, unknown> | null | undefined
) => metadata?.gift_wrap_line === true

const buildMetadataFilter = (metadata: Record<string, unknown>) => {
  if (!isGiftWrapLineMetadata(metadata)) {
    return metadata
  }

  const filter: Record<string, unknown> = {
    gift_wrap_line: true,
  }

  if (metadata.gift_wrap_fee !== undefined) {
    filter.gift_wrap_fee = metadata.gift_wrap_fee
  }

  return filter
}

const metadataMatchesCartLine = (
  itemMetadata: Record<string, unknown> | null | undefined,
  expectedMetadata: Record<string, unknown> | null | undefined
) => {
  if (
    isGiftWrapLineMetadata(itemMetadata) &&
    isGiftWrapLineMetadata(expectedMetadata)
  ) {
    return itemMetadata?.gift_wrap_fee === expectedMetadata?.gift_wrap_fee
  }

  return metadataMatchesExactly(itemMetadata, expectedMetadata)
}

const removeGiftWrapMetadata = (
  metadata: Record<string, unknown> | null | undefined
) => {
  if (!metadata) {
    return null
  }

  const {
    gift_wrap: _giftWrap,
    gift_wrap_fee: _giftWrapFee,
    gift_wrap_packages: _giftWrapPackages,
    ...rest
  } = metadata

  return Object.keys(rest).length > 0 ? rest : null
}

const cloneMetadata = (
  metadata: Record<string, unknown> | null | undefined
): Record<string, unknown> | null => {
  if (!metadata) {
    return null
  }

  return JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>
}

const getCartClientForUser = async (userId: string | null) => {
  if (userId) {
    return createClient()
  }
  return createAdminClient()
}

const getCartClient = async () => {
  const authUser = await getAuthUser()
  if (authUser) return createClient()
  return createAdminClient()
}

const resolveAuthenticatedCustomerEmail = async (
  userId: string
): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>
  email: string | null
}> => {
  const supabase = await createClient()

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("contact_email, email")
    .eq("id", userId)
    .maybeSingle<CustomerEmailProfileRow>()

  if (profileError) {
    console.warn(
      "Failed to load profile contact email while resolving cart write context:",
      profileError
    )
  }

  return {
    supabase,
    email: getCustomerFacingEmail(
      profile?.contact_email,
      profile?.email
    ),
  }
}

const resolveCartWriteContext = async (): Promise<CartWriteContext> => {
  const authUser = await getAuthUser()
  if (authUser) {
    const resolvedCustomer = await resolveAuthenticatedCustomerEmail(authUser.id)

    return {
      supabase: resolvedCustomer.supabase,
      userId: authUser.id,
      email: resolvedCustomer.email || getCustomerFacingEmail(authUser.email),
    }
  }

  return {
    supabase: await createAdminClient(),
    userId: null,
    email: null,
  }
}

const isOrderedCartForUser = async (
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  cartId: string
): Promise<boolean> => {
  const { data, error } = await supabase
    .from("orders")
    .select("id")
    .eq("user_id", userId)
    .contains("metadata", { cart_id: cartId })
    .in("status", ["pending", "order_placed", "accepted", "shipped", "delivered"])
    .limit(1)

  if (error || !data) {
    if (error) {
      console.warn("Failed to check ordered cart status:", error)
    }
    return false
  }

  return data.length > 0
}

const findLatestActiveCartIdForUserWithClient = async (
  supabase: CartWriteContext["supabase"],
  userId: string
): Promise<string | null> => {
  const { data, error } = await supabase
    .from("carts")
    .select("id, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(10)

  if (error || !data) {
    if (error) {
      console.warn("Failed to load active cart for user:", error)
    }
    return null
  }

  const cartCandidates = data as ActiveCartCandidateRow[]
  const candidateIds = cartCandidates.map((cart) => cart.id)

  if (candidateIds.length === 0) {
    return null
  }

  const { data: orderRows, error: orderError } = await supabase
    .from("orders")
    .select("metadata")
    .eq("user_id", userId)
    .in("status", ["pending", "order_placed", "accepted", "shipped", "delivered"])
    .in("metadata->>cart_id", candidateIds)

  if (orderError) {
    console.warn("Failed to load ordered cart candidates:", orderError)
  }

  const orderedCartIds = new Set(
    ((orderRows || []) as OrderCartMetadataRow[])
      .map((order) => order.metadata?.cart_id)
      .filter((cartId): cartId is string => typeof cartId === "string")
  )

  const latestCart = cartCandidates.find((cart) => !orderedCartIds.has(cart.id))

  return latestCart?.id ?? null
}

export const findLatestActiveCartIdForUser = async (
  userId: string
): Promise<string | null> => {
  const supabase = await createClient()
  return findLatestActiveCartIdForUserWithClient(supabase, userId)
}

const getCookieCartForUser = async (
  userId: string | null,
  cartId: string
): Promise<CartOwnershipRow | null> => {
  const supabase = userId ? await createClient() : await createAdminClient()
  const { data, error } = await supabase
    .from("carts")
    .select("id, user_id, email, updated_at")
    .eq("id", cartId)
    .maybeSingle<CartOwnershipRow>()

  if (error || !data) {
    return null
  }

  return data
}

const resolveCartIdForRead = async (
  requestedCartId?: string
): Promise<string | null> => {
  const user = await getAuthUser()
  const cookieCartId = requestedCartId || (await getCartId())

  if (requestedCartId) {
    return requestedCartId
  }

  if (!user) {
    return cookieCartId ?? null
  }

  if (cookieCartId) {
    const cookieCart = await getCookieCartForUser(user.id, cookieCartId)

    if (cookieCart?.user_id === user.id || cookieCart?.user_id === null) {
      const supabase = await createClient()
      const isOrderedCart = await isOrderedCartForUser(
        supabase,
        user.id,
        cookieCart.id
      )

      if (isOrderedCart) {
        return findLatestActiveCartIdForUser(user.id)
      }

      return cookieCart.id
    }
  }

  return findLatestActiveCartIdForUser(user.id)
}

const touchCart = async (
  supabase: CartWriteContext["supabase"],
  cartId: string
) => {
  await supabase
    .from("carts")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", cartId)
}

const loadCartMergeItems = async (
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  cartId: string
): Promise<CartMergeItemRow[]> => {
  const { data, error } = await supabase
    .from("cart_items")
    .select("id, cart_id, product_id, variant_id, quantity, metadata")
    .eq("cart_id", cartId)

  if (error || !data) {
    if (error) {
      console.warn("Failed to load cart items for merge:", error)
    }
    return []
  }

  return data as CartMergeItemRow[]
}

const mergeCartItems = async ({
  supabase,
  sourceCartId,
  targetCartId,
}: {
  supabase: Awaited<ReturnType<typeof createAdminClient>>
  sourceCartId: string
  targetCartId: string
}) => {
  const [sourceItems, targetItems] = await Promise.all([
    loadCartMergeItems(supabase, sourceCartId),
    loadCartMergeItems(supabase, targetCartId),
  ])

  for (const sourceItem of sourceItems) {
    const matchingTarget = targetItems.find(
      (targetItem) =>
        targetItem.product_id === sourceItem.product_id &&
        targetItem.variant_id === sourceItem.variant_id &&
        metadataMatchesCartLine(targetItem.metadata, sourceItem.metadata)
    )

    if (matchingTarget) {
      const nextQuantity =
        Number(matchingTarget.quantity ?? 0) + Number(sourceItem.quantity ?? 0)

      const { error } = await supabase
        .from("cart_items")
        .update({ quantity: nextQuantity })
        .eq("id", matchingTarget.id)

      if (!error) {
        matchingTarget.quantity = nextQuantity
      }
      continue
    }

    const { data: insertedItem, error } = await supabase
      .from("cart_items")
      .insert({
        cart_id: targetCartId,
        product_id: sourceItem.product_id,
        variant_id: sourceItem.variant_id,
        quantity: sourceItem.quantity ?? 0,
        metadata: cloneMetadata(sourceItem.metadata),
      })
      .select("id, cart_id, product_id, variant_id, quantity, metadata")
      .single<CartMergeItemRow>()

    if (!error && insertedItem) {
      targetItems.push(insertedItem)
    }
  }

  await supabase.from("cart_items").delete().eq("cart_id", sourceCartId)
  await supabase.from("carts").delete().eq("id", sourceCartId).is("user_id", null)
  await touchCart(supabase, targetCartId)
}

export async function mergeOrClaimGuestCartForUser({
  cartId,
  userId,
  email,
}: {
  cartId: string
  userId: string
  email: string | null
}): Promise<string | null> {
  const adminSupabase = await createAdminClient()
  const { data: guestCart, error: guestCartError } = await adminSupabase
    .from("carts")
    .select("id, user_id, email, updated_at")
    .eq("id", cartId)
    .maybeSingle<CartOwnershipRow>()

  if (guestCartError || !guestCart) {
    if (guestCartError) {
      console.warn("Failed to load guest cart during login handoff:", guestCartError)
    }
    return null
  }

  if (guestCart.user_id === userId) {
    return guestCart.id
  }

  if (guestCart.user_id && guestCart.user_id !== userId) {
    console.warn(
      `Skipping cart handoff because cart ${cartId} already belongs to a different user.`
    )
    return findLatestActiveCartIdForUserWithClient(adminSupabase, userId)
  }

  const existingCartId = await findLatestActiveCartIdForUserWithClient(
    adminSupabase,
    userId
  )
  const updatePayload = {
    user_id: userId,
    email,
    updated_at: new Date().toISOString(),
  }

  if (!existingCartId || existingCartId === guestCart.id) {
    const { error } = await adminSupabase
      .from("carts")
      .update(updatePayload)
      .eq("id", guestCart.id)
      .is("user_id", null)

    if (error) {
      console.warn("Failed to claim guest cart during login handoff:", error)
      return null
    }

    return guestCart.id
  }

  await mergeCartItems({
    supabase: adminSupabase,
    sourceCartId: guestCart.id,
    targetCartId: existingCartId,
  })

  await adminSupabase
    .from("carts")
    .update({
      email,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existingCartId)

  return existingCartId
}

export async function retrieveCart(cartId?: string): Promise<Cart | null> {
  return cachedRetrieveCart(cartId)
}

const cachedRetrieveCart = cache(
  async (cartId?: string): Promise<Cart | null> => {
    return retrieveCartRaw(cartId)
  }
)

export async function retrieveCartRaw(cartId?: string): Promise<Cart | null> {
  const id = await resolveCartIdForRead(cartId)
  if (!id) return null

  const user = await getAuthUser()
  const supabase = await getCartClientForUser(user?.id ?? null)
  const { data: cartData, error } = await supabase
    .from("carts")
    .select(
      `
      id,
      email,
      user_id,
      region_id,
      currency_code,
      shipping_address,
      billing_address,
      shipping_methods,
      payment_collection,
      metadata,
      created_at,
      updated_at,
      promo_code,
      discount_total,
      items:cart_items(
        id,
        cart_id,
        product_id,
        variant_id,
        quantity,
        metadata,
        created_at,
        updated_at,
        product:products(
          id,
          handle,
          name,
          price,
          currency_code,
          image_url,
          thumbnail,
          images,
          metadata,
          status
        ),
        variant:product_variants(
          id,
          title,
          sku,
          price,
          inventory_quantity,
          manage_inventory,
          allow_backorder,
          product_id,
          options,
          image_url
        )
      ),
      promotion:promotions(
        id,
        code,
        type,
        value,
        min_order_amount,
        is_active,
        is_deleted,
        starts_at,
        ends_at,
        max_uses,
        used_count,
        created_at,
        updated_at
      )
    `
    )
    .eq("id", id)
    .maybeSingle()

  if (error || !cartData) {
    return null
  }

  // Security: reject cart if it belongs to a different user
  if (cartData.user_id && user && cartData.user_id !== user.id) {
    return null
  }

  // Check if user is a club member and get discount percentage
  let isClubMember = false
  let clubDiscountPercentage = 0
  let availableRewards = 0

  if (user) {
    isClubMember = user.user_metadata?.is_club_member === true
    if (isClubMember) {
      // Dynamically import to avoid circular dependency
      const { getClubSettings } = await import("@lib/data/club")
      const settings = await getClubSettings()
      clubDiscountPercentage = settings.discount_percentage

      // Get reward wallet balance
      const { data: wallet } = await supabase
        .from("reward_wallets")
        .select("balance")
        .eq("user_id", user.id)
        .maybeSingle()

      availableRewards = wallet?.balance ?? 0
    }
  }

  // Get global settings for gift wrap fee
  const { getGlobalSettings } = await import("@lib/data/settings")
  const globalSettings = await getGlobalSettings()
  const giftWrapFee = globalSettings?.gift_wrap_fee ?? 50

  const items = mapCartItems(
    (cartData.items as unknown as DatabaseCartItem[]) || [],
    clubDiscountPercentage,
    giftWrapFee
  )

  // Get payment discount percentage if a method is selected
  const paymentCollection = cartData.payment_collection as
    | PaymentCollection
    | null
    | undefined

  const selectedPaymentProviderId =
    paymentCollection?.payment_sessions?.find(
      (session) => session.status === "pending"
    )?.provider_id

  let paymentDiscountPercentage = 0
  if (isFullOnlinePaymentProvider(selectedPaymentProviderId)) {
    const { data: provider } = await supabase
      .from("payment_providers")
      .select("discount_percentage")
      .eq("id", selectedPaymentProviderId)
      .maybeSingle()

    paymentDiscountPercentage = provider?.discount_percentage || 0
  }

  // Get shipping threshold from active shipping options
  const { data: shippingOptions } = await supabase
    .from("shipping_options")
    .select("id, name, amount, min_order_free_shipping")
    .eq("is_active", true)

  const shippingOptionsData = (shippingOptions || []).map(
    (opt: CartShippingOptionRow) => ({
      shipping_option_id: opt.id,
      name: opt.name,
      amount: opt.amount,
      min_order_free_shipping: opt.min_order_free_shipping,
    })
  ) as CartShippingMethod[]

  const standardOption = shippingOptionsData.find((so) =>
    so.name.toLowerCase().includes("standard")
  )
  const defaultShippingOption =
    standardOption ||
    shippingOptionsData.find((so) => so.min_order_free_shipping !== null)

  const totals = calculateCartTotals({
    items,
    promotion: cartData.promotion as unknown as Promotion,
    shippingMethods: cartData.shipping_methods as CartShippingMethod[],
    availableRewards,
    cartMetadata: (cartData.metadata || {}) as Record<string, unknown>,
    isClubMember,
    clubDiscountPercentage,
    paymentDiscountPercentage,
    defaultShippingOption,
  })

  const freeShippingThreshold =
    standardOption?.min_order_free_shipping ||
    shippingOptionsData.find((so) => so.min_order_free_shipping !== null)
      ?.min_order_free_shipping ||
    500 // Fallback

  const cart: Cart = {
    ...cartData,
    ...totals,
    items,
    promotions: cartData.promotion
      ? [cartData.promotion as unknown as Promotion]
      : [],
    free_shipping_threshold: freeShippingThreshold,
  }

  return cart
}

export async function getOrSetCart(context?: CartWriteContext): Promise<Cart> {
  const existingCart = await retrieveCart()
  if (existingCart) return existingCart

  try {
    const writeContext = context ?? (await resolveCartWriteContext())
    const supabase = writeContext.supabase

    const newCartId = randomUUID()

    const { data: newCart, error } = await supabase
      .from("carts")
      .insert({
        id: newCartId,
        user_id: writeContext.userId,
        currency_code: "inr",
        email: writeContext.email,
      })
      .select("id, user_id, currency_code, email, created_at, updated_at")
      .single()

    if (error || !newCart) {
      console.error("[getOrSetCart] Failed to create cart:", error)
      throw new Error(
        `Could not create cart: ${error?.message || "Unknown error"}`
      )
    }

    // Set the cart cookie
    await setCartId(newCart.id)
    revalidateTag("cart", "max")

    // Try to retrieve the full cart, but if it fails, return basic cart info
    const freshCart = await retrieveCart(newCart.id)
    if (freshCart) {
      return freshCart
    }

    // Fallback: if retrieveCart fails, return a minimal cart object
    // This prevents cascading failures when retrieveCart has issues
    const basicCart: Cart = {
      id: newCart.id,
      user_id: newCart.user_id,
      currency_code: newCart.currency_code || "inr",
      email: newCart.email || null,
      items: [],
      subtotal: 0,
      item_subtotal: 0,
      total: 0,
      shipping_total: 0,
      tax_total: 0,
      discount_total: 0,
      created_at: newCart.created_at || new Date().toISOString(),
      updated_at: newCart.updated_at || new Date().toISOString(),
    }

    return basicCart
  } catch (error) {
    console.error("[getOrSetCart] Error:", error)
    throw error
  }
}

export async function addToCart({
  productId,
  quantity,
  variantId,
  metadata,
}: {
  productId: string
  quantity: number
  variantId?: string
  metadata?: Record<string, unknown>
}) {
  try {
    const writeContext = await resolveCartWriteContext()

    // Get or create cart with better error handling
    let cartId: string
    try {
      const cart = await getOrSetCart(writeContext)
      cartId = cart.id
    } catch (cartError) {
      console.error("[addToCart] Failed to get or create cart:", cartError)
      throw new Error(
        `Failed to get or create cart: ${
          cartError instanceof Error ? cartError.message : "Unknown error"
        }`
      )
    }

    const supabase = writeContext.supabase

    let targetVariantId = variantId === productId ? undefined : variantId
    if (!targetVariantId) {
      try {
        const { data: variants, error: variantError } = await supabase
          .from("product_variants")
          .select("id")
          .eq("product_id", productId)
          .limit(1)

        if (variantError) {
          console.error("[addToCart] Error fetching variants:", variantError)
        }

        if (variants && variants.length > 0) {
          targetVariantId = variants[0].id
        }
      } catch (variantFetchError) {
        console.error(
          "[addToCart] Failed to fetch variants:",
          variantFetchError
        )
        // Continue without variant if fetch fails
      }
    }

    // Find if item already exists in cart with EXACT SAME metadata.
    let existingItems: unknown[] | null = null
    try {
      const query = supabase
        .from("cart_items")
        .select("id, quantity, metadata")
        .eq("cart_id", cartId)
        .eq("product_id", productId)

      if (targetVariantId) {
        query.eq("variant_id", targetVariantId)
      } else {
        query.is("variant_id", null)
      }

      if (metadata) {
        query.contains("metadata", buildMetadataFilter(metadata))
      } else {
        query.is("metadata", null)
      }

      const { data: foundItems, error: queryError } = await query

      if (queryError) {
        console.error("[addToCart] Error querying existing items:", queryError)
      } else {
        existingItems = foundItems
      }
    } catch (queryError) {
      console.error("[addToCart] Failed to query existing items:", queryError)
    }

    const existingItem = existingItems?.find(
      (item: unknown): item is CartItemMetadataRow => {
        if (!item || typeof item !== "object") return false
        const cartItem = item as CartItemMetadataRow
        return metadataMatchesCartLine(cartItem.metadata, metadata)
      }
    )

    if (existingItem) {
      try {
        const currentQuantity =
          typeof existingItem.quantity === "number" ? existingItem.quantity : 0
        const { error: updateError } = await supabase
          .from("cart_items")
          .update({ quantity: (currentQuantity || 0) + quantity })
          .eq("id", existingItem.id)

        if (updateError) {
          console.error(
            "[addToCart] Error updating existing item:",
            updateError
          )
          throw new Error(`Failed to update cart item: ${updateError.message}`)
        }
      } catch (updateError) {
        console.error(
          "[addToCart] Failed to update item quantity:",
          updateError
        )
        throw updateError
      }
    } else {
      try {
        const { error: insertError } = await supabase
          .from("cart_items")
          .insert({
            cart_id: cartId,
            product_id: productId,
            variant_id: targetVariantId,
            quantity,
            metadata: cloneMetadata(metadata),
          })

        if (insertError) {
          console.error("[addToCart] Error inserting new item:", insertError)
          throw new Error(`Failed to add item to cart: ${insertError.message}`)
        }
      } catch (insertError) {
        console.error("[addToCart] Failed to insert new item:", insertError)
        throw insertError
      }
    }

    revalidateTag("cart", "max")
    await touchCart(supabase, cartId)
    return retrieveCartRaw(cartId)
  } catch (error) {
    console.error("[addToCart] Fatal error:", error)
    throw error
  }
}

export async function addMultipleToCart(
  items: {
    productId: string
    quantity: number
    variantId?: string
    metadata?: Record<string, unknown>
  }[]
) {
  const writeContext = await resolveCartWriteContext()
  const cart = await getOrSetCart(writeContext)
  const cartId = cart.id
  const supabase = writeContext.supabase

  for (const item of items) {
    let targetVariantId =
      item.variantId === item.productId ? undefined : item.variantId
    if (!targetVariantId) {
      const { data: variants } = await supabase
        .from("product_variants")
        .select("id")
        .eq("product_id", item.productId)
        .limit(1)

      if (variants && variants.length > 0) {
        targetVariantId = variants[0].id
      }
    }

    const existingQuery = supabase
      .from("cart_items")
      .select("id, quantity, metadata")
      .eq("cart_id", cartId)
      .eq("product_id", item.productId)

    if (targetVariantId) {
      existingQuery.eq("variant_id", targetVariantId)
    } else {
      existingQuery.is("variant_id", null)
    }

    if (item.metadata) {
      existingQuery.contains("metadata", buildMetadataFilter(item.metadata))
    } else {
      existingQuery.is("metadata", null)
    }

    const { data: existingItems } = await existingQuery

    const existingItem = existingItems?.find((cartItem) =>
      metadataMatchesCartLine(cartItem.metadata, item.metadata)
    )

    if (existingItem) {
      await supabase
        .from("cart_items")
        .update({ quantity: (existingItem.quantity || 0) + item.quantity })
        .eq("id", existingItem.id)
    } else {
      await supabase.from("cart_items").insert({
        cart_id: cartId,
        product_id: item.productId,
        variant_id: targetVariantId || null,
        quantity: item.quantity,
        metadata: cloneMetadata(item.metadata),
      })
    }
  }

  revalidateTag("cart", "max")
  await touchCart(supabase, cartId)
  return retrieveCartRaw(cartId)
}

export async function updateLineItem({
  lineId,
  quantity,
}: {
  lineId: string
  quantity: number
}) {
  const writeContext = await resolveCartWriteContext()
  const supabase = writeContext.supabase
  await supabase.from("cart_items").update({ quantity }).eq("id", lineId)

  const cart = await retrieveCartRaw()
  if (cart) {
    await touchCart(supabase, cart.id)
  }

  revalidateTag("cart", "max")
  return cart
}

export async function deleteLineItem(lineId: string) {
  const writeContext = await resolveCartWriteContext()
  const supabase = writeContext.supabase
  const { data: lineItem } = await supabase
    .from("cart_items")
    .select("id, cart_id, product_id, metadata")
    .eq("id", lineId)
    .maybeSingle<CartItemGiftWrapRemovalRow>()

  const lineMetadata = lineItem?.metadata || null

  await supabase.from("cart_items").delete().eq("id", lineId)

  if (lineItem && isGiftWrapLineMetadata(lineMetadata)) {
    const giftWrapFee = lineMetadata?.gift_wrap_fee
    const productLinesQuery = supabase
      .from("cart_items")
      .select("id, metadata")
      .eq("cart_id", lineItem.cart_id)
      .eq("product_id", lineItem.product_id)
      .contains("metadata", { gift_wrap: true })

    if (giftWrapFee !== undefined) {
      productLinesQuery.contains("metadata", { gift_wrap_fee: giftWrapFee })
    }

    const { data: productLines } = await productLinesQuery

    for (const productLine of productLines || []) {
      await supabase
        .from("cart_items")
        .update({
          metadata: removeGiftWrapMetadata(
            productLine.metadata as Record<string, unknown> | null
          ),
        })
        .eq("id", productLine.id)
    }
  } else if (lineItem && lineMetadata?.gift_wrap === true) {
    const giftWrapFee = lineMetadata.gift_wrap_fee
    const remainingWrappedProductLinesQuery = supabase
      .from("cart_items")
      .select("id")
      .eq("cart_id", lineItem.cart_id)
      .eq("product_id", lineItem.product_id)
      .contains("metadata", { gift_wrap: true })

    if (giftWrapFee !== undefined) {
      remainingWrappedProductLinesQuery.contains("metadata", {
        gift_wrap_fee: giftWrapFee,
      })
    }

    const { data: remainingWrappedProductLines } =
      await remainingWrappedProductLinesQuery

    if (
      !remainingWrappedProductLines ||
      remainingWrappedProductLines.length === 0
    ) {
      const giftWrapQuery = supabase
        .from("cart_items")
        .delete()
        .eq("cart_id", lineItem.cart_id)
        .eq("product_id", lineItem.product_id)
        .contains("metadata", { gift_wrap_line: true })

      if (giftWrapFee !== undefined) {
        giftWrapQuery.contains("metadata", { gift_wrap_fee: giftWrapFee })
      }

      await giftWrapQuery
    }
  }

  if (lineItem) {
    await touchCart(supabase, lineItem.cart_id)
  }

  revalidateTag("cart", "max")
  return retrieveCartRaw()
}

// Background auto-save (no redirect) - Fixes blank page issue
export async function saveAddressesBackground(
  _currentState: unknown,
  formData: FormData
) {
  const cart = await retrieveCart()
  if (!cart) return { message: "No cart found", success: false }

  const supabase = await getCartClient()

  const shippingPhone = formData.get("shipping_address.phone") as string
  if (!shippingPhone || shippingPhone.trim() === "") {
    return { message: "Phone number is required", success: false }
  }

  const shippingPostalCode = formData.get("shipping_address.postal_code")
  const billingPostalCode = formData.get("billing_address.postal_code")
  const resolvedBillingPostalCode =
    typeof billingPostalCode === "string" && billingPostalCode !== ""
      ? billingPostalCode
      : shippingPostalCode

  if (
    typeof shippingPostalCode !== "string" ||
    typeof resolvedBillingPostalCode !== "string" ||
    !isValidIndianPincode(shippingPostalCode) ||
    !isValidIndianPincode(resolvedBillingPostalCode)
  ) {
    return { message: INDIAN_PINCODE_ERROR, success: false }
  }

  const data = {
    email: formData.get("email") as string,
    shipping_address: {
      first_name: formData.get("shipping_address.first_name"),
      last_name: formData.get("shipping_address.last_name"),
      address_1: formData.get("shipping_address.address_1"),
      company: formData.get("shipping_address.company"),
      postal_code: shippingPostalCode,
      city: formData.get("shipping_address.city"),
      country_code: formData.get("shipping_address.country_code"),
      province: formData.get("shipping_address.province"),
      phone: formData.get("shipping_address.phone"),
    },
    billing_address: {
      first_name:
        formData.get("billing_address.first_name") ||
        formData.get("shipping_address.first_name"),
      last_name:
        formData.get("billing_address.last_name") ||
        formData.get("shipping_address.last_name"),
      address_1:
        formData.get("billing_address.address_1") ||
        formData.get("shipping_address.address_1"),
      company:
        formData.get("billing_address.company") ||
        formData.get("shipping_address.company"),
      postal_code: resolvedBillingPostalCode,
      city:
        formData.get("billing_address.city") ||
        formData.get("shipping_address.city"),
      country_code:
        formData.get("billing_address.country_code") ||
        formData.get("shipping_address.country_code"),
      province:
        formData.get("billing_address.province") ||
        formData.get("shipping_address.province"),
      phone:
        formData.get("billing_address.phone") ||
        formData.get("shipping_address.phone"),
    },
  }

  const { error } = await supabase.from("carts").update(data).eq("id", cart.id)

  if (error) {
    return { message: error.message, success: false }
  }

  // Claim cart for user if not already linked
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user && !cart.user_id) {
    await supabase.from("carts").update({ user_id: user.id }).eq("id", cart.id)
  }

  // Save address to profile if requested
  const saveToProfile = formData.get("save_address") === "on"
  if (saveToProfile && user) {
    try {
      // Check if this exact address already exists for the user to avoid duplicates
      const { data: existingAddresses, error: fetchError } = await supabase
        .from("addresses")
        .select("id")
        .eq("user_id", user.id)
        .eq("address_1", data.shipping_address.address_1)
        .eq("postal_code", data.shipping_address.postal_code)
        .maybeSingle()

      if (!fetchError && !existingAddresses) {
        await supabase.from("addresses").insert({
          user_id: user.id,
          first_name: data.shipping_address.first_name,
          last_name: data.shipping_address.last_name,
          address_1: data.shipping_address.address_1,
          company: data.shipping_address.company,
          postal_code: data.shipping_address.postal_code,
          city: data.shipping_address.city,
          country_code: data.shipping_address.country_code,
          province: data.shipping_address.province,
          phone: data.shipping_address.phone,
        })
      }
    } catch (e) {
      console.error("Failed to save address to profile:", e)
    }
  }

  // Update shipping method automatically
  await autoSelectStandardShipping(cart.id)

  revalidateTag("cart", "max")
  revalidateTag("customers", "max")
  return { message: "Saved", success: true }
}

type SavedAddressInput = {
  first_name: string
  last_name: string
  address_1: string
  address_2?: string | null
  company?: string | null
  postal_code: string
  city: string
  country_code: string
  province?: string | null
  phone?: string | null
}

type StoredAddressRow = {
  id: string
  is_default_billing: boolean | null
  is_default_shipping: boolean | null
}

type AddressDefaults = {
  makeDefaultBilling: boolean
  makeDefaultShipping: boolean
}

function normalizeAddressValue(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim()
  return trimmedValue ? trimmedValue : null
}

function normalizeSavedAddressInput(address: SavedAddressInput): SavedAddressInput {
  return {
    first_name: normalizeAddressValue(address.first_name) || "",
    last_name: normalizeAddressValue(address.last_name) || "",
    address_1: normalizeAddressValue(address.address_1) || "",
    address_2: normalizeAddressValue(address.address_2),
    company: normalizeAddressValue(address.company),
    postal_code: normalizeAddressValue(address.postal_code) || "",
    city: normalizeAddressValue(address.city) || "",
    country_code: (normalizeAddressValue(address.country_code) || "in").toLowerCase(),
    province: normalizeAddressValue(address.province),
    phone: normalizeAddressValue(address.phone),
  }
}

function areSavedAddressesEqual(
  leftAddress: SavedAddressInput,
  rightAddress: SavedAddressInput
): boolean {
  const normalizedLeftAddress = normalizeSavedAddressInput(leftAddress)
  const normalizedRightAddress = normalizeSavedAddressInput(rightAddress)

  return (
    normalizedLeftAddress.first_name === normalizedRightAddress.first_name &&
    normalizedLeftAddress.last_name === normalizedRightAddress.last_name &&
    normalizedLeftAddress.address_1 === normalizedRightAddress.address_1 &&
    normalizedLeftAddress.address_2 === normalizedRightAddress.address_2 &&
    normalizedLeftAddress.company === normalizedRightAddress.company &&
    normalizedLeftAddress.postal_code === normalizedRightAddress.postal_code &&
    normalizedLeftAddress.city === normalizedRightAddress.city &&
    normalizedLeftAddress.country_code === normalizedRightAddress.country_code &&
    normalizedLeftAddress.province === normalizedRightAddress.province &&
    normalizedLeftAddress.phone === normalizedRightAddress.phone
  )
}

async function clearDefaultAddressRole(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  userId: string,
  role: "billing" | "shipping"
) {
  const defaultColumn =
    role === "billing" ? "is_default_billing" : "is_default_shipping"

  await supabase
    .from("addresses")
    .update({ [defaultColumn]: false })
    .eq("user_id", userId)
}

async function findExistingUserAddress(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  userId: string,
  address: SavedAddressInput
): Promise<StoredAddressRow | null> {
  const normalizedAddress = normalizeSavedAddressInput(address)
  const { data, error } = await supabase
    .from("addresses")
    .select("id, is_default_billing, is_default_shipping")
    .eq("user_id", userId)
    .eq("first_name", normalizedAddress.first_name)
    .eq("last_name", normalizedAddress.last_name)
    .eq("address_1", normalizedAddress.address_1)
    .eq("postal_code", normalizedAddress.postal_code)
    .eq("city", normalizedAddress.city)
    .eq("country_code", normalizedAddress.country_code)
    .limit(1)

  if (error) {
    return null
  }

  return ((data || [])[0] as StoredAddressRow | undefined) ?? null
}

async function upsertUserAddressWithDefaults({
  supabase,
  userId,
  address,
  makeDefaultBilling,
  makeDefaultShipping,
}: {
  supabase: Awaited<ReturnType<typeof createAdminClient>>
  userId: string
  address: SavedAddressInput
} & AddressDefaults) {
  if (!isValidIndianPincode(address.postal_code)) {
    throw new Error(INDIAN_PINCODE_ERROR)
  }
  const normalizedAddress = normalizeSavedAddressInput(address)
  const existingAddress = await findExistingUserAddress(
    supabase,
    userId,
    normalizedAddress
  )

  if (makeDefaultBilling) {
    await clearDefaultAddressRole(supabase, userId, "billing")
  }

  if (makeDefaultShipping) {
    await clearDefaultAddressRole(supabase, userId, "shipping")
  }

  const addressPayload = {
    first_name: normalizedAddress.first_name,
    last_name: normalizedAddress.last_name,
    address_1: normalizedAddress.address_1,
    address_2: normalizedAddress.address_2,
    company: normalizedAddress.company,
    postal_code: normalizedAddress.postal_code,
    city: normalizedAddress.city,
    country_code: normalizedAddress.country_code,
    province: normalizedAddress.province,
    phone: normalizedAddress.phone,
    is_default_billing: makeDefaultBilling
      ? true
      : existingAddress?.is_default_billing ?? false,
    is_default_shipping: makeDefaultShipping
      ? true
      : existingAddress?.is_default_shipping ?? false,
  }

  if (existingAddress) {
    await supabase.from("addresses").update(addressPayload).eq("id", existingAddress.id)
    return
  }

  await supabase.from("addresses").insert({
    user_id: userId,
    ...addressPayload,
  })
}

export async function saveCheckoutAddresses({
  billingAddress,
  shippingAddress,
  userId,
}: {
  billingAddress: SavedAddressInput
  shippingAddress: SavedAddressInput
  userId: string
}) {
  const supabase = await createAdminClient()

  try {
    if (areSavedAddressesEqual(billingAddress, shippingAddress)) {
      await upsertUserAddressWithDefaults({
        supabase,
        userId,
        address: billingAddress,
        makeDefaultBilling: true,
        makeDefaultShipping: true,
      })
    } else {
      await upsertUserAddressWithDefaults({
        supabase,
        userId,
        address: billingAddress,
        makeDefaultBilling: true,
        makeDefaultShipping: false,
      })
      await upsertUserAddressWithDefaults({
        supabase,
        userId,
        address: shippingAddress,
        makeDefaultBilling: false,
        makeDefaultShipping: true,
      })
    }

    revalidateTag("customers", "max")
    revalidateTag("admin-customers", "max")
  } catch (e) {
    console.error("Failed to save address to profile:", e)
  }
}

export async function saveUserAddress(address: SavedAddressInput, userId: string) {
  const supabase = await createAdminClient()

  try {
    const { count } = await supabase
      .from("addresses")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)

    await upsertUserAddressWithDefaults({
      supabase,
      userId,
      address,
      makeDefaultBilling: count === 0,
      makeDefaultShipping: count === 0,
    })

    revalidateTag("customers", "max")
    revalidateTag("admin-customers", "max")
  } catch (e) {
    console.error("Failed to save address to profile:", e)
  }
}

export async function autoSelectStandardShipping(
  cartId: string,
  skipRevalidate = false
) {
  const { shipping_options } = await listCartOptions()
  // Auto-select first option if available (Standard Shipping)
  if (shipping_options.length > 0) {
    return await setShippingMethod({
      cartId,
      shippingMethodId: shipping_options[0].id,
      skipRevalidate,
    })
  }
  return null
}

// Explicit submit with redirect - Skips delivery step as we auto-select
export async function submitAddresses(formData: FormData) {
  // Pass null as state since saveAddressesBackground expects it
  const result = await saveAddressesBackground(null, formData)

  if (!result.success) {
    // If save fails, we return the result. In a server action used in formAction,
    // we can't easily return data to the client without useActionState.
    // However, since we are redirecting on success, if we don't redirect,
    // it means failure. We might want to throw or handle error better,
    // but for now let's just match the signature.
    throw new Error(result.message)
  }

  const cart = await retrieveCart()
  if (cart) {
    await autoSelectStandardShipping(cart.id)
  }

  redirect("/checkout?step=payment")
}

export async function setShippingMethod({
  cartId,
  shippingMethodId,
  skipRevalidate = false,
}: {
  cartId: string
  shippingMethodId: string
  skipRevalidate?: boolean
}) {
  const supabase = await getCartClient()

  const { shipping_options } = await listCartOptions()
  const option = shipping_options.find((o) => o.id === shippingMethodId)

  const methodData = {
    id: shippingMethodId, // Use option ID as method ID for internal tracking
    shipping_option_id: shippingMethodId,
    name: option?.name || "Standard Shipping",
    amount: option?.amount || 0,
    price_type: (option?.price_type || "flat") as "flat" | "calculated",
    min_order_free_shipping: option?.min_order_free_shipping ?? null,
  }

  const { error } = await supabase
    .from("carts")
    .update({
      shipping_methods: [methodData],
      updated_at: new Date().toISOString(),
    })
    .eq("id", cartId)

  if (error) throw new Error(error.message)

  if (!skipRevalidate) {
    revalidateTag("cart", "max")
  }

  return methodData
}

export async function setPaymentProvider(providerId: string) {
  const cart = await retrieveCartRaw()
  if (!cart) return

  const supabase = await getCartClient()

  const paymentCollection = {
    payment_sessions: [
      {
        provider_id: providerId,
        status: "pending",
        data: {},
      },
    ],
  }

  const { error } = await supabase
    .from("carts")
    .update({
      payment_collection: paymentCollection as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cart.id)

  if (error) {
    console.error("Error setting payment provider:", error)
    throw new Error(error.message)
  }

  revalidateTag("cart", "max")
}

async function getPaymentCallbackBaseURL(): Promise<string> {
  // Always try to detect the real host from request headers first.
  // This works in all environments:
  //   - Development: host = "localhost:3000", no x-forwarded-proto → "http://localhost:3000"
  //   - Vercel production: x-forwarded-host = "toycker.com", x-forwarded-proto = "https"
  //       → "https://toycker.com"
  //   - Vercel preview: auto-detects the preview URL correctly
  // Falls back to NEXT_PUBLIC_BASE_URL env var only if headers are unavailable.
  try {
    const { headers } = await import("next/headers")
    const headersList = await headers()
    const host =
      headersList.get("x-forwarded-host") || headersList.get("host")
    if (host) {
      const proto =
        headersList.get("x-forwarded-proto") ||
        (host.includes("localhost") ? "http" : "https")
      return `${proto}://${host}`
    }
  } catch {
    // headers() not available in this context (e.g. called outside a request)
  }

  return getBaseURL()
}

export async function initiatePaymentSession(
  cartInput: { id: string },
  data: {
    provider_id: string
    data?: Record<string, unknown>
    customerEmail?: string
    customerAddress?: {
      first_name: string
      phone?: string | null
    }
  }
) {
  const supabase = await getCartClient()
  const cart = await retrieveCart(cartInput.id)
  if (!cart) throw new Error("Cart not found")

  let sessionData = data.data || {}

  if (data.provider_id === "pp_payu_payu") {
    // 1. Retrieve keys from Environment Variables (Vercel)
    const key = process.env.PAYU_MERCHANT_KEY
    const salt = process.env.PAYU_MERCHANT_SALT
    const isTestMode = process.env.PAYU_ENVIRONMENT === "test"

    if (!key || !salt) {
      throw new Error(
        "PayU configuration missing: PAYU_MERCHANT_KEY or PAYU_MERCHANT_SALT not set."
      )
    }

    // 2. Format Data for PayU
    const txnid = `txn${Date.now()}`
    const amount = Number(cart.total || 0).toFixed(2) // Strictly 2 decimal places
    const productinfo = "Store_Order"
    const checkoutCustomerAddress =
      data.customerAddress ?? cart.billing_address ?? cart.shipping_address
    const firstname = (checkoutCustomerAddress?.first_name || "Guest")
      .trim()
      .replace(/[^a-zA-Z0-9 ]/g, "")
    const email = (
      getCustomerFacingEmail(data.customerEmail, cart.email) ||
      "guest@toycker.in"
    ).trim()
    const phone =
      (checkoutCustomerAddress?.phone || "9999999999").replace(/\D/g, "") ||
      "9999999999"

    const baseUrl = await getPaymentCallbackBaseURL()

    // 3. Prepare Hash Parameters
    const hashParams: PayUHashParams = {
      key,
      txnid,
      amount,
      productinfo,
      firstname,
      email,
      udf1: cart.id, // Storing Cart ID in UDF1 for tracking
      udf2: "",
      udf3: "",
      udf4: "",
      udf5: "",
    }

    const hash = generatePayUHash(hashParams, salt)

    // 4. Construct Payment Session Data
    sessionData = {
      payment_url: isTestMode
        ? "https://test.payu.in/_payment"
        : "https://secure.payu.in/_payment",
      params: {
        ...hashParams,
        hash,
        surl: `${baseUrl}/api/payu/callback`,
        furl: `${baseUrl}/api/payu/callback`,
        phone,
        // Note: service_provider: "payu_paisa" removed - deprecated since 2016
      },
    }
  } else if (
    data.provider_id === "pp_easebuzz_easebuzz" ||
    data.provider_id === "pp_easebuzz_partial_payment"
  ) {
    // Easebuzz payment gateway integration
    // Step 1: Read credentials from environment
    const key = process.env.EASEBUZZ_MERCHANT_KEY
    const salt = process.env.EASEBUZZ_MERCHANT_SALT
    const isTestMode = process.env.EASEBUZZ_ENVIRONMENT === "test"

    if (!key || !salt) {
      throw new Error(
        "Easebuzz configuration missing: EASEBUZZ_MERCHANT_KEY or EASEBUZZ_MERCHANT_SALT not set."
      )
    }

    // Step 2: Format payment data
    const txnid = `txn${Date.now()}`
    const expiresAt = new Date(Date.now() + 16 * 60 * 1000).toISOString()
    const fullOrderAmount = Number(cart.total || 0)
    const partialPaymentRuleMatchAmount = Number(
      cart.item_subtotal ?? cart.subtotal ?? fullOrderAmount
    )
    let advancePercentage: number | null = null
    let payableAmount = fullOrderAmount
    let balanceAmount = 0
    let resolvedPartialPaymentRule: PartialPaymentRuleInput | null = null

    if (data.provider_id === "pp_easebuzz_partial_payment") {
      const { data: providerConfig, error: providerError } = await supabase
        .from("payment_providers")
        .select("partial_payment_percentage")
        .eq("id", data.provider_id)
        .maybeSingle<PartialPaymentProviderConfig>()

      if (providerError) {
        throw new Error(providerError.message)
      }

      const fallbackPercentage = Number(
        providerConfig?.partial_payment_percentage ?? 0
      )
      const { data: ruleRows, error: rulesError } = await supabase
        .from("partial_payment_rules")
        .select("id, min_order_amount, max_order_amount, advance_percentage, is_active, sort_order")
        .eq("payment_provider_id", data.provider_id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("min_order_amount", { ascending: true })

      if (rulesError) {
        throw new Error(rulesError.message)
      }

      const resolvedRule = resolvePartialPaymentRule({
        finalOrderAmount: partialPaymentRuleMatchAmount,
        rules: (ruleRows ?? []) as PartialPaymentRuleInput[],
        fallbackPercentage,
      })
      const configuredPercentage = resolvedRule.percentage
      resolvedPartialPaymentRule = resolvedRule.rule

      if (
        !Number.isFinite(configuredPercentage) ||
        configuredPercentage <= 0 ||
        configuredPercentage >= 100
      ) {
        throw new Error(
          "Partial payment percentage must be greater than 0 and less than 100."
        )
      }

      advancePercentage = configuredPercentage
      const partialPaymentSplit = calculatePartialPaymentSplit(
        fullOrderAmount,
        configuredPercentage
      )
      payableAmount = partialPaymentSplit.advanceAmount
      balanceAmount = partialPaymentSplit.balanceAmount
    }

    const amount = payableAmount.toFixed(2)
    const productinfo = "Store Order"
    const checkoutCustomerAddress =
      data.customerAddress ?? cart.billing_address ?? cart.shipping_address
    const firstname = (checkoutCustomerAddress?.first_name || "Guest")
      .trim()
      .replace(/[^a-zA-Z0-9 ]/g, "")
    const email = (
      getCustomerFacingEmail(data.customerEmail, cart.email) ||
      "guest@toycker.in"
    ).trim()
    const phone =
      (checkoutCustomerAddress?.phone || "9999999999").replace(/\D/g, "") ||
      "9999999999"

    const baseUrl = await getPaymentCallbackBaseURL()
    const callbackUrl = `${baseUrl}/api/easebuzz/callback`

    // Step 3: Generate hash (same algorithm as PayU)
    const hashParams: EasebuzzHashParams = {
      key,
      txnid,
      amount,
      productinfo,
      firstname,
      email,
      udf1: cart.id, // Cart ID stored in UDF1 for callback tracking
      udf2: "",
      udf3: "",
      udf4: "",
      udf5: "",
    }

    const hash = generateEasebuzzHash(hashParams, salt)

    // Step 4: Call Easebuzz initiate payment API (server-to-server)
    const apiBaseUrl = isTestMode
      ? "https://testpay.easebuzz.in"
      : "https://pay.easebuzz.in"

    const formBody = new URLSearchParams({
      key,
      txnid,
      amount,
      productinfo,
      firstname,
      email,
      phone,
      surl: callbackUrl,
      furl: callbackUrl,
      hash,
      udf1: cart.id,
      udf2: "",
      udf3: "",
      udf4: "",
      udf5: "",
    })

    const apiResponse = await fetch(`${apiBaseUrl}/payment/initiateLink`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody.toString(),
    })

    if (!apiResponse.ok) {
      throw new Error(
        `Easebuzz API request failed with status ${apiResponse.status}`
      )
    }

    const apiResult = (await apiResponse.json()) as {
      status: number
      data: string
      error_desc?: string
    }

    if (apiResult.status !== 1 || !apiResult.data) {
      throw new Error(
        `Easebuzz initiate payment failed: ${apiResult.error_desc || "Unknown error"}`
      )
    }

    const accessKey = apiResult.data
    const paymentUrl = `${apiBaseUrl}/pay/${accessKey}`

    // Step 5: Store only the redirect URL (no form params needed for Easebuzz)
    sessionData = {
      payment_url: paymentUrl,
      txnid,
      expires_at: expiresAt,
      payment_type:
        data.provider_id === "pp_easebuzz_partial_payment" ? "partial" : "full",
      advance_percentage: advancePercentage,
      partial_payment_rule_id: resolvedPartialPaymentRule?.id ?? null,
      partial_payment_rule_min_order_amount:
        resolvedPartialPaymentRule?.min_order_amount ?? null,
      partial_payment_rule_max_order_amount:
        resolvedPartialPaymentRule?.max_order_amount ?? null,
      advance_amount:
        data.provider_id === "pp_easebuzz_partial_payment"
          ? payableAmount
          : fullOrderAmount,
      balance_amount:
        data.provider_id === "pp_easebuzz_partial_payment" ? balanceAmount : 0,
      full_order_amount: fullOrderAmount,
    }
  }

  const paymentCollection = {
    payment_sessions: [
      {
        provider_id: data.provider_id,
        status: "pending",
        data: sessionData,
      },
    ],
  }

  const { error } = await supabase
    .from("carts")
    .update({
      payment_collection: paymentCollection as PaymentCollection,
    })
    .eq("id", cart.id)

  if (error) throw new Error(error.message)

  revalidateTag("cart", "max")
  revalidatePath("/checkout")
}

export async function placeOrder() {
  const cart = await retrieveCart()
  if (!cart) throw new Error("No cart found")

  const supabase = await getCartClient()

  // Calculate proper totals from cart
  const item_subtotal = cart.item_subtotal ?? cart.subtotal ?? 0
  const shipping_total = cart.shipping_total ?? 0
  const tax_total = cart.tax_total ?? 0
  const discount_total = cart.discount_total ?? 0
  const gift_card_total = cart.gift_card_total ?? 0
  const rewards_discount = cart.rewards_discount ?? 0
  const total =
    cart.total ??
    item_subtotal +
      shipping_total +
      tax_total -
      discount_total -
      gift_card_total -
      rewards_discount
  const customerEmail =
    getCustomerFacingEmail(cart.email) || "guest@toycker.in"

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      user_id: cart.user_id,
      customer_email: customerEmail,
      email: customerEmail,
      total_amount: total,
      total: total,
      subtotal: item_subtotal,
      tax_total: tax_total,
      shipping_total: shipping_total,
      discount_total: discount_total + rewards_discount,
      gift_card_total: gift_card_total,
      currency_code: cart.currency_code,
      status: "order_placed",
      payment_status: "captured",
      fulfillment_status: "not_shipped",
      shipping_address: cart.shipping_address,
      billing_address: cart.billing_address,
      items: JSON.parse(JSON.stringify(cart.items || [])),
      shipping_methods: JSON.parse(JSON.stringify(cart.shipping_methods || [])),
      promo_code: cart.promotions?.[0]?.code || null,
      metadata: {
        cart_id: cart.id,
        rewards_used: rewards_discount,
        promo_code: cart.promotions?.[0]?.code || null,
      },
    })
    .select()
    .single()

  if (orderError) throw new Error(orderError.message)

  // Log "Order Placed" event
  const { logOrderEvent } = await import("@lib/data/admin")
  await logOrderEvent(
    order.id,
    "order_placed",
    "Order Placed",
    "Customer placed this order.",
    "customer"
  )

  // Handle post-order logic (rewards, membership, etc.)
  await handlePostOrderLogic(order, cart, rewards_discount)

  revalidateTag("rewards", "max")
  revalidateTag("cart", "max")

  redirect(`/order/confirmed/${order.id}`)
}

/**
 * Reusable helper to handle post-order logic like membership activation,
 * rewards calculation, and event logging.
 */
export async function handlePostOrderLogic(
  order: Order,
  cart: Cart,
  rewards_discount: number
) {
  const supabase = await getCartClient()
  const orderMetadata = getOrderPricingMetadata(order.metadata)
  const clubSavings = getAppliedClubSavings({
    metadata: order.metadata,
    items: order.items,
    cartClubSavings: cart.club_savings,
  })
  const clubSavingsAlreadyCredited = orderMetadata.club_savings_credited === true

  // Handle rewards and club functionality for logged-in users
  if (order.user_id) {
    const { syncClubMembershipForOrder } = await import("@lib/data/club")
    const { deductRewards } = await import("@lib/data/rewards")

    // 1. Deduct reward points used (now works — rewards.ts uses admin client)
    if (rewards_discount > 0) {
      await deductRewards(order.user_id, order.id, rewards_discount)
    }

    // 3. Update order metadata
    const metadataUpdate: OrderPricingMetadata = {
      ...getOrderPricingMetadata(order.metadata),
      rewards_used: rewards_discount,
    }

    if (rewards_discount > 0) {
      metadataUpdate.rewards_discount = rewards_discount
    }

    if (clubSavings > 0) {
      metadataUpdate.club_savings_amount = clubSavings
      metadataUpdate.club_savings = clubSavings
      metadataUpdate.is_club_member = true
    }

    // 4. Persist Lifetime Club Savings (fixed: use admin API instead of getAuthUser)
    if (clubSavings > 0 && !clubSavingsAlreadyCredited) {
      const adminSupabase = await createAdminClient()
      const {
        data: { user },
      } = await adminSupabase.auth.admin.getUserById(order.user_id)
      if (user) {
        const currentSavings = Number(
          user.user_metadata?.total_club_savings || 0
        )
        const newSavings = currentSavings + clubSavings

        await adminSupabase.auth.admin.updateUserById(order.user_id, {
          user_metadata: {
            ...user.user_metadata,
            total_club_savings: newSavings,
          },
        })
        await adminSupabase
          .from("profiles")
          .update({
            total_club_savings: newSavings,
          })
          .eq("id", order.user_id)

        metadataUpdate.club_savings_credited = true
        revalidateTag("customers", "max")
      }
    }

    // Always update metadata if we have something new to add
    if (
      rewards_discount > 0 ||
      clubSavings > 0 ||
      metadataUpdate.club_savings_credited === true
    ) {
      await supabase
        .from("orders")
        .update({
          metadata: metadataUpdate,
        })
        .eq("id", order.id)
    }

    // 5. Sync club eligibility after metadata updates so audit fields are not overwritten.
    const clubMembershipResult = await syncClubMembershipForOrder(
      order.id,
      "order_created_or_payment_captured"
    )
    if (clubMembershipResult.activated) {
      revalidateTag("customers", "max")
    }
  }

  // 6. Update promotion use count
  const promo_code =
    order.promo_code || orderMetadata.promo_code || cart.promotions?.[0]?.code
  if (promo_code) {
    const { data: promotion } = await supabase
      .from("promotions")
      .select("id")
      .eq("code", promo_code)
      .maybeSingle()

    if (promotion) {
      await supabase.rpc("increment_promotion_uses", { promo_id: promotion.id })
    }
  }
}

export async function createBuyNowCart({
  variantId,
  productId,
  quantity,
  countryCode: _countryCode,
  metadata,
}: {
  variantId?: string | null
  productId?: string
  quantity: number
  countryCode: string
  metadata?: Record<string, unknown>
}) {
  const writeContext = await resolveCartWriteContext()
  const supabase = writeContext.supabase

  const newCartId = randomUUID()

  const { error } = await supabase.from("carts").insert({
    id: newCartId,
    user_id: writeContext.userId,
    currency_code: "inr",
    email: writeContext.email,
  })

  if (error) throw new Error(error.message)

  let targetProductId = productId || ""

  if (variantId && !targetProductId) {
    const { data: variant } = await supabase
      .from("product_variants")
      .select("product_id")
      .eq("id", variantId)
      .single()
    if (variant) targetProductId = variant.product_id
  }

  if (targetProductId) {
    // Insert main product
    await supabase.from("cart_items").insert({
      cart_id: newCartId,
      product_id: targetProductId,
      variant_id: variantId || null,
      quantity: quantity,
      metadata: cloneMetadata(metadata),
    })

    // If gift wrap is selected, add as a separate line
    if (metadata && metadata.gift_wrap === true) {
      await supabase.from("cart_items").insert({
        cart_id: newCartId,
        product_id: targetProductId,
        variant_id: null,
        quantity: 1,
        metadata: {
          gift_wrap_line: true,
          gift_wrap_fee: metadata.gift_wrap_fee || 50,
          parent_line_id: `parent-${variantId || productId}`,
        },
      })
    }
  }

  await setCartId(newCartId)
  revalidateTag("cart", "max")
  // Pass cartId in URL as fallback in case cookie is lost during redirect (Next.js issue #61611)
  redirect(`/checkout?step=address&cartId=${newCartId}`)
}

export async function listCartOptions(): Promise<{
  shipping_options: ShippingOption[]
}> {
  const supabase = await getCartClient()
  const { data, error } = await supabase
    .from("shipping_options")
    .select("id, name, amount, min_order_free_shipping")
    .eq("is_active", true)

  if (error) {
    console.error("Error fetching shipping options:", error.message)
    return { shipping_options: [] }
  }

  return {
    shipping_options: (data || []).map((opt: CartShippingOptionRow) => ({
      id: opt.id,
      name: opt.name,
      amount: opt.amount,
      min_order_free_shipping: opt.min_order_free_shipping,
      price_type: "flat",
      prices: [{ amount: opt.amount, currency_code: "inr" }],
    })),
  }
}

export async function updateRegion(countryCode: string, currentPath: string) {
  redirect(currentPath)
}

export async function applyPromotions(codes: string[]) {
  const cart = await retrieveCartRaw()
  if (!cart) throw new Error("No cart found")

  const supabase = await getCartClient()

  if (codes.length === 0) {
    const { error } = await supabase
      .from("carts")
      .update({
        promo_code: null,
        discount_total: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cart.id)
    if (error) throw new Error("Could not remove promotion code")
    revalidateTag("cart", "max")
    return
  }

  const code = codes[0].toUpperCase()

  // Verify code exists and is active
  const { data: promotion, error: promoError } = await supabase
    .from("promotions")
    .select("*")
    .eq("code", code)
    .eq("is_active", true)
    .eq("is_deleted", false)
    .maybeSingle()

  if (promoError || !promotion) {
    throw new Error("Invalid promotion code")
  }

  // Basic validation (dates and uses)
  const now = new Date()
  if (promotion.starts_at && new Date(promotion.starts_at) > now) {
    throw new Error("This promotion has not started yet")
  }
  if (promotion.ends_at && new Date(promotion.ends_at) < now) {
    throw new Error("This promotion has expired")
  }
  if (
    promotion.max_uses !== null &&
    promotion.used_count >= promotion.max_uses
  ) {
    throw new Error("This promotion has reached its usage limit")
  }

  // Check min order amount against current cart
  if (cart && (cart.item_subtotal ?? 0) < (promotion.min_order_amount || 0)) {
    throw new Error(
      `Minimum order amount of ₹${promotion.min_order_amount} required to use this code`
    )
  }

  // Calculate discount amount based on promotion type
  let discountAmount = 0
  const subtotal = cart?.item_subtotal ?? 0

  if (promotion.type === "percentage") {
    discountAmount = Math.round((subtotal * promotion.value) / 100)
  } else if (promotion.type === "fixed") {
    discountAmount = promotion.value
  }
  // For free_shipping, discount_amount stays 0 (shipping discount handled separately)

  // Update both promo_code and discount_total
  const { error } = await supabase
    .from("carts")
    .update({
      promo_code: code,
      discount_total: discountAmount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cart.id)

  if (error) throw new Error("Could not apply promotion code")

  revalidateTag("cart", "max")
}
export async function updateCartRewards(points: number) {
  const activeCart = await retrieveCartRaw()
  if (!activeCart) throw new Error("No cart found")

  const supabase = await getCartClient()

  const { data: cart } = await supabase
    .from("carts")
    .select("metadata")
    .eq("id", activeCart.id)
    .single()

  const metadata = {
    ...(cart?.metadata || {}),
    rewards_to_apply: points,
  }

  const { error } = await supabase
    .from("carts")
    .update({
      metadata,
      updated_at: new Date().toISOString(),
    })
    .eq("id", activeCart.id)

  if (error) throw new Error("Could not update rewards")

  revalidateTag("cart", "max")
}
