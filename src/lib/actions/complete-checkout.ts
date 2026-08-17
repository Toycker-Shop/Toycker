"use server"

import { isIP } from "node:net"
import { z } from "zod"
import { revalidateTag } from "next/cache"
import { cookies, headers } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { Order, PaymentCollection } from "@/lib/supabase/types"
import { resolveCustomerPhone } from "@/lib/util/customer-contact-phone"
import { INDIAN_PINCODE_ERROR, INDIAN_PINCODE_PATTERN } from "@/lib/util/indian-pincode"
import { getCheckoutPhoneValue } from "@/lib/util/customer-phone"
import { sendGa4PurchaseEventForOrderId } from "@/lib/integrations/ga4"
import { sendMetaPurchaseEvent } from "@/lib/integrations/meta-capi"

// Validation schema for checkout data
const AddressSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  address_1: z.string().min(1, "Address is required"),
  address_2: z.string().optional().nullable(),
  city: z.string().min(1, "City is required"),
  province: z.string().optional().nullable(),
  postal_code: z.string().regex(INDIAN_PINCODE_PATTERN, INDIAN_PINCODE_ERROR),
  country_code: z.string().min(2, "Country is required"),
  phone: z.string().optional().nullable(),
})

const CheckoutSchema = z.object({
  cartId: z.string().min(1, "Cart ID is required"),
  email: z.string().email("Invalid email address"),
  shippingAddress: AddressSchema,
  billingAddress: AddressSchema,
  paymentMethod: z.string().min(1, "Payment method is required"),
  rewardsToApply: z.number().int().min(0).optional().default(0),
  saveAddress: z.boolean().optional(),
})

export type CheckoutData = z.infer<typeof CheckoutSchema>

export interface CheckoutPaymentData {
  client_secret?: string
  payment_url?: string
  params?: Record<string, string | number | boolean | null | undefined>
  [key: string]: unknown
}

export interface CheckoutResult {
  success: boolean
  orderId?: string
  paymentData?: CheckoutPaymentData | null
  error?: string
}

type CheckoutProfileRow = {
  first_name: string | null
  last_name: string | null
  phone: string | null
}

function normalizeOptionalValue(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim()
  return trimmedValue ? trimmedValue : null
}

function isBlank(value: string | null | undefined): boolean {
  return !value?.trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getClientIp(requestHeaders: Headers): string | undefined {
  const forwardedIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim()
  const directIp = requestHeaders.get("x-real-ip")?.trim()
  const candidate = forwardedIp || directIp
  return candidate && isIP(candidate) ? candidate : undefined
}

function resolveLockedBillingPhone(
  profilePhone: string | null | undefined,
  userMetadata: unknown,
  authPhone: string | null | undefined
): string | null {
  const accountPhone = resolveCustomerPhone({
    profilePhone,
    userMetadata,
    authPhone,
  })

  return normalizeOptionalValue(getCheckoutPhoneValue(accountPhone))
}

function mapCheckoutAddressToSavedAddress(address: CheckoutData["billingAddress"]) {
  return {
    first_name: address.first_name.trim(),
    last_name: address.last_name.trim(),
    address_1: address.address_1.trim(),
    address_2: normalizeOptionalValue(address.address_2),
    company: normalizeOptionalValue(address.address_2),
    postal_code: address.postal_code.trim(),
    city: address.city.trim(),
    country_code: address.country_code.trim().toLowerCase(),
    province: normalizeOptionalValue(address.province),
    phone: normalizeOptionalValue(address.phone),
  }
}

export async function completeCheckout(
  data: CheckoutData
): Promise<CheckoutResult> {
  try {
    // Validate input data
    const validatedData = CheckoutSchema.parse(data)

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    let existingProfile: CheckoutProfileRow | null = null

    if (user) {
      const { data: profileRow, error: profileReadError } = await supabase
        .from("profiles")
        .select("first_name, last_name, phone")
        .eq("id", user.id)
        .maybeSingle<CheckoutProfileRow>()

      if (profileReadError) {
        console.warn(
          "Failed to load profile before checkout profile sync:",
          profileReadError
        )
      }

      existingProfile = profileRow
    }

    const lockedBillingPhone = user
      ? resolveLockedBillingPhone(
          existingProfile?.phone,
          user.user_metadata,
          user.phone
        )
      : null
    const checkoutData: CheckoutData = {
      ...validatedData,
      billingAddress: {
        ...validatedData.billingAddress,
        phone:
          lockedBillingPhone ??
          normalizeOptionalValue(validatedData.billingAddress.phone),
      },
    }

    const orderSupabase = await createAdminClient()
    const requestCookies = await cookies()
    const requestHeaders = await headers()
    const marketingIdentifiers: Record<string, string> = {}
    const gaClientId = requestCookies.get("_ga")?.value.trim()
    const visitorId = requestCookies.get("toycker_meta_visitor_id")?.value.trim()
    const fbp = requestCookies.get("_fbp")?.value.trim()
    const fbc = requestCookies.get("_fbc")?.value.trim()
    const clientIp = getClientIp(requestHeaders)
    const clientUserAgent = requestHeaders.get("user-agent")?.trim()

    if (gaClientId) marketingIdentifiers.ga_client_id = gaClientId
    if (visitorId) marketingIdentifiers.visitor_id = visitorId
    if (fbp) marketingIdentifiers.fbp = fbp
    if (fbc) marketingIdentifiers.fbc = fbc
    if (clientIp) marketingIdentifiers.client_ip_address = clientIp
    if (clientUserAgent) marketingIdentifiers.client_user_agent = clientUserAgent

    if (Object.keys(marketingIdentifiers).length > 0) {
      const { data: cartMetadataRow, error: cartMetadataError } =
        await orderSupabase
          .from("carts")
          .select("metadata")
          .eq("id", checkoutData.cartId)
          .maybeSingle()

      if (cartMetadataError) {
        console.warn(
          "Failed to read cart metadata for Meta identifiers:",
          cartMetadataError,
        )
      } else {
        const existingMetadata = isRecord(cartMetadataRow?.metadata)
          ? cartMetadataRow.metadata
          : {}
        const existingMarketing = isRecord(existingMetadata.marketing)
          ? existingMetadata.marketing
          : {}

        const { error: cartMetadataUpdateError } = await orderSupabase
          .from("carts")
          .update({
            metadata: {
              ...existingMetadata,
              marketing: {
                ...existingMarketing,
                ...marketingIdentifiers,
              },
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", checkoutData.cartId)

        if (cartMetadataUpdateError) {
          console.warn(
            "Failed to persist Meta identifiers on cart:",
            cartMetadataUpdateError,
          )
        }
      }
    }

    // Step 1: Initialize payment session (generates client secrets, PayU/Easebuzz hashes, etc.)
    // This updates the cart in the DB with the necessary payment data
    const { initiatePaymentSession } = await import("@lib/data/cart")
    await initiatePaymentSession(
      { id: checkoutData.cartId },
      {
        provider_id: checkoutData.paymentMethod,
        customerEmail: checkoutData.email,
        customerAddress: checkoutData.billingAddress,
      }
    )

    // Step 2: Cancel any stale pending online-payment orders for this cart before
    // creating a new one. This handles the case where the user abandoned a previous
    // payment attempt (closed browser, navigated away) without the callback firing.
    const isGatewayPayment =
      checkoutData.paymentMethod.includes("payu") ||
      checkoutData.paymentMethod.includes("easebuzz")

    if (isGatewayPayment) {
      const { cancelPendingPaymentOrders } = await import(
        "@/lib/actions/cancel-pending-payment"
      )
      await cancelPendingPaymentOrders(checkoutData.cartId)
    }

    // Step 3: Call Supabase RPC function for atomic order creation
    // The RPC will now find the initialized payment session data in the cart record
    const { data: result, error } = await orderSupabase.rpc(
      "create_order_with_payment",
      {
        p_cart_id: checkoutData.cartId,
        p_email: checkoutData.email,
        p_shipping_address: checkoutData.shippingAddress,
        p_billing_address: checkoutData.billingAddress,
        p_payment_provider: checkoutData.paymentMethod,
        p_rewards_to_apply: checkoutData.rewardsToApply,
      }
    )

    if (error) {
      console.error("Order creation error:", error)
      return {
        success: false,
        error: error.message || "Failed to create order. Please try again.",
      }
    }

    if (user) {
      const profileUpdate: {
        contact_email: string
        first_name?: string
        last_name?: string
        phone?: string
      } = {
        contact_email: checkoutData.email.trim(),
      }

      if (isBlank(existingProfile?.first_name)) {
        profileUpdate.first_name = checkoutData.billingAddress.first_name.trim()
      }

      if (isBlank(existingProfile?.last_name)) {
        profileUpdate.last_name = checkoutData.billingAddress.last_name.trim()
      }

      if (isBlank(existingProfile?.phone)) {
        const accountPhone = normalizeOptionalValue(
          resolveCustomerPhone({
            profilePhone: existingProfile?.phone,
            userMetadata: user.user_metadata,
            authPhone: user.phone,
          })
        )

        if (accountPhone) {
          profileUpdate.phone = accountPhone
        } else {
          const billingPhone = normalizeOptionalValue(checkoutData.billingAddress.phone)
          if (billingPhone) {
            profileUpdate.phone = billingPhone
          }
        }
      }

      const { error: profileUpdateError } = await supabase
        .from("profiles")
        .update(profileUpdate)
        .eq("id", user.id)

      if (profileUpdateError) {
        console.warn(
          "Failed to persist checkout profile details:",
          profileUpdateError
        )
      } else {
        revalidateTag("customers", "max")
        revalidateTag("admin-customers", "max")
      }
    }

    // Auto-save address if requested
    if (validatedData.saveAddress && user) {
      try {
        const { saveCheckoutAddresses } = await import("@lib/data/cart")

        await saveCheckoutAddresses({
          billingAddress: mapCheckoutAddressToSavedAddress(
            checkoutData.billingAddress
          ),
          shippingAddress: mapCheckoutAddressToSavedAddress(
            checkoutData.shippingAddress
          ),
          userId: user.id,
        })
      } catch (err) {
        console.error("Failed to auto-save address during checkout:", err)
      }
    }

    // Fetch the created order to get any updated payment data (like Stripe client_secret)
    const { data: orderData } = await orderSupabase
      .from("orders")
      .select("*, payment_collection")
      .eq("id", result.order_id)
      .single()


    if (orderData && Object.keys(marketingIdentifiers).length > 0) {
      const existingMetadata = isRecord(orderData.metadata)
        ? orderData.metadata
        : {}
      const existingMarketing = isRecord(existingMetadata.marketing)
        ? existingMetadata.marketing
        : {}
      const metadata = {
        ...existingMetadata,
        marketing: {
          ...existingMarketing,
          ...marketingIdentifiers,
        },
      }

      const { error: orderMetadataError } = await orderSupabase
        .from("orders")
        .update({ metadata })
        .eq("id", result.order_id)

      if (orderMetadataError) {
        console.warn(
          "Failed to persist marketing identifiers on order:",
          orderMetadataError,
        )
      }
    }
    // Step 4: For non-gateway payments (COD, manual), run post-order logic now.
    // Gateway payments (PayU, Easebuzz) handle this in their callback after payment verification.

    if (!isGatewayPayment && orderData) {
      const { handlePostOrderLogic, retrieveCart } = await import(
        "@lib/data/cart"
      )
      const cart = await retrieveCart(checkoutData.cartId)
      if (cart) {
        await handlePostOrderLogic(
          orderData,
          cart,
          checkoutData.rewardsToApply
        )
      }
      await sendGa4PurchaseEventForOrderId(result.order_id, "cash_on_delivery")
      await sendMetaPurchaseEvent(orderData as unknown as Order)
    }

    // Cart clearing is handled by ClearCartOnMount on the confirmation page
    // to avoid "Not Found" race conditions during payment gateway handoffs.

    return {
      success: true,
      orderId: result.order_id,
      paymentData:
        (((orderData?.payment_collection as PaymentCollection | null | undefined)
          ?.payment_sessions.find(
            (session) => session.provider_id === checkoutData.paymentMethod
          )?.data as CheckoutPaymentData | undefined) ?? null),
    }
  } catch (error) {
    console.error("Checkout error:", error)

    if (error instanceof z.ZodError) {
      const firstError = error.issues[0]
      return {
        success: false,
        error: firstError?.message || "Invalid checkout data",
      }
    }

    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "An unexpected error occurred. Please try again.",
    }
  }
}
