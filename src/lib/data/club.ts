"use server"

import { cache } from "react"
import { revalidateTag, updateTag, unstable_cache } from "next/cache"

import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { createPublicClient } from "@/lib/supabase/public-server"
import type { ClubSettings } from "@/lib/supabase/types"
import {
  getAppliedClubSavings,
  getOrderPricingMetadata,
} from "@/lib/util/order-pricing"

type ClubMembershipStatus = "none" | "pending_eligible" | "active" | "revoked"

type ClubOrderRow = {
  id: string
  user_id: string | null
  status: string | null
  fulfillment_status: string | null
  payment_status: string | null
  payment_method: string | null
  subtotal: number | null
  total: number | null
  items: unknown
  metadata: Record<string, unknown> | null
  created_at?: string | null
}

type ProfileClubAuditUpdate = {
  is_club_member: boolean
  club_member_since: string | null
  club_membership_status: ClubMembershipStatus
  club_qualifying_order_id: string | null
  club_revocation_reason: string | null
}

type AuthUserMetadata = {
  [key: string]: unknown
  is_club_member?: boolean
  club_member_since?: string | null
  total_club_savings?: number
  club_membership_status?: ClubMembershipStatus
  club_qualifying_order_id?: string | null
  club_revocation_reason?: string | null
}

const INVALID_ORDER_STATUSES = new Set(["cancelled", "failed"])
const INVALID_PAYMENT_STATUSES = new Set(["cancelled", "failed", "refunded"])
const COMPLETED_PAYMENT_STATUSES = new Set(["captured", "paid"])

const getClubSettingsInternal = async (): Promise<ClubSettings> => {
  const supabase = createPublicClient()

  const { data, error } = await supabase
    .from("club_settings")
    .select("*")
    .eq("id", "default")
    .single()

  if (error || !data) {
    return {
      id: "default",
      min_purchase_amount: 999,
      discount_percentage: 10,
      rewards_percentage: 5,
      is_active: true,
      updated_at: new Date().toISOString(),
    }
  }

  return data as ClubSettings
}

export const getClubSettings = cache(async () => {
  return await unstable_cache(getClubSettingsInternal, ["club-settings"], {
    revalidate: 600,
    tags: ["club_settings"],
  })()
})

export async function updateClubSettings(settings: Partial<ClubSettings>) {
  const supabase = await createClient()

  const { error } = await supabase
    .from("club_settings")
    .update({
      ...settings,
      updated_at: new Date().toISOString(),
    })
    .eq("id", "default")

  if (error) {
    throw new Error(`Failed to update settings: ${error.message}`)
  }

  updateTag("club_settings")
  updateTag("products")
  updateTag("storefront-catalog")
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.trim())
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

const isGiftWrapLine = (item: Record<string, unknown>): boolean => {
  const metadata = isRecord(item.metadata) ? item.metadata : null
  return metadata?.gift_wrap_line === true
}

const getLineTotal = (item: Record<string, unknown>): number => {
  const directTotal =
    toFiniteNumber(item.original_total) ?? toFiniteNumber(item.total)
  if (directTotal !== null) return directTotal

  const quantity = toFiniteNumber(item.quantity) ?? 1
  const unitPrice =
    toFiniteNumber(item.original_unit_price) ?? toFiniteNumber(item.unit_price)

  return unitPrice !== null ? unitPrice * quantity : 0
}

const getEligibleItemSubtotal = ({
  items,
  fallbackSubtotal,
}: {
  items: unknown
  fallbackSubtotal?: number | null
}): number => {
  if (!Array.isArray(items) || items.length === 0) {
    return Math.max(0, Number(fallbackSubtotal ?? 0))
  }

  return items.reduce((sum, item) => {
    if (!isRecord(item) || isGiftWrapLine(item)) return sum
    return sum + getLineTotal(item)
  }, 0)
}

const getNormalized = (value: string | null | undefined): string =>
  (value || "").toLowerCase()

const isInvalidOrder = (order: ClubOrderRow): boolean =>
  INVALID_ORDER_STATUSES.has(getNormalized(order.status)) ||
  INVALID_PAYMENT_STATUSES.has(getNormalized(order.payment_status))

const isPaymentComplete = (order: ClubOrderRow): boolean =>
  COMPLETED_PAYMENT_STATUSES.has(getNormalized(order.payment_status))

const isCodOrManualPaymentMethod = (
  paymentMethod: string | null | undefined
): boolean => {
  const normalized = getNormalized(paymentMethod)
  return (
    normalized.includes("cod") ||
    normalized.includes("cash") ||
    normalized.includes("pp_system_default") ||
    normalized === "manual"
  )
}

const isDelivered = (order: ClubOrderRow): boolean =>
  getNormalized(order.status) === "delivered" ||
  getNormalized(order.fulfillment_status) === "delivered"

const shouldActivateForCurrentState = (order: ClubOrderRow): boolean => {
  if (isInvalidOrder(order)) return false

  if (isCodOrManualPaymentMethod(order.payment_method)) {
    return isDelivered(order) && isPaymentComplete(order)
  }

  return isPaymentComplete(order)
}

const fetchOrderForClub = async (
  orderId: string
): Promise<ClubOrderRow | null> => {
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, user_id, status, fulfillment_status, payment_status, payment_method, subtotal, total, items, metadata, created_at"
    )
    .eq("id", orderId)
    .maybeSingle()

  if (error) {
    console.error(`[CLUB] Failed to fetch order ${orderId}:`, error)
    return null
  }

  return data as ClubOrderRow | null
}

const updateOrderClubMetadata = async (
  order: ClubOrderRow,
  metadataPatch: Record<string, unknown>
) => {
  const supabase = await createAdminClient()
  const metadata = getOrderPricingMetadata(order.metadata)

  const { error } = await supabase
    .from("orders")
    .update({
      metadata: {
        ...metadata,
        ...metadataPatch,
      },
    })
    .eq("id", order.id)

  if (error) {
    console.error(`[CLUB] Failed to update order metadata ${order.id}:`, error)
  }
}

const updateUserClubAudit = async (
  userId: string,
  update: ProfileClubAuditUpdate
) => {
  const supabase = await createAdminClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.admin.getUserById(userId)

  if (userError || !user) {
    console.error(`[CLUB] User not found for audit update ${userId}:`, userError)
    return false
  }

  const metadata = (user.user_metadata || {}) as AuthUserMetadata
  const totalClubSavings = Number(metadata.total_club_savings || 0)

  const { error: authError } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...metadata,
      is_club_member: update.is_club_member,
      club_member_since: update.club_member_since,
      total_club_savings: totalClubSavings,
      club_membership_status: update.club_membership_status,
      club_qualifying_order_id: update.club_qualifying_order_id,
      club_revocation_reason: update.club_revocation_reason,
    },
  })

  if (authError) {
    console.error(`[CLUB] Failed to update auth metadata ${userId}:`, authError)
    return false
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", userId)

  if (profileError) {
    console.error(`[CLUB] Failed to update profile audit ${userId}:`, profileError)
    return false
  }

  revalidateTag("customers", "max")
  return true
}

const activateMembershipForOrder = async (
  order: ClubOrderRow,
  qualifyingSubtotal: number
): Promise<boolean> => {
  if (!order.user_id) return false

  const supabase = await createAdminClient()
  const { data: profile } = await supabase
    .from("profiles")
    .select("club_member_since")
    .eq("id", order.user_id)
    .maybeSingle()

  const now = new Date().toISOString()
  const updated = await updateUserClubAudit(order.user_id, {
    is_club_member: true,
    club_member_since: profile?.club_member_since || now,
    club_membership_status: "active",
    club_qualifying_order_id: order.id,
    club_revocation_reason: null,
  })

  if (!updated) return false

  await updateOrderClubMetadata(order, {
    club_membership_status: "active",
    club_qualifying_order_id: order.id,
    club_qualifying_subtotal: qualifyingSubtotal,
    club_membership_activated_at: now,
    newly_activated_club_member: true,
  })

  return true
}

const markPendingEligible = async (
  order: ClubOrderRow,
  qualifyingSubtotal: number
): Promise<boolean> => {
  if (!order.user_id) return false

  const supabase = await createAdminClient()
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_club_member")
    .eq("id", order.user_id)
    .maybeSingle()

  if (profile?.is_club_member) {
    await updateOrderClubMetadata(order, {
      club_membership_status: "active",
      club_qualifying_subtotal: qualifyingSubtotal,
    })
    return true
  }

  const updated = await updateUserClubAudit(order.user_id, {
    is_club_member: false,
    club_member_since: null,
    club_membership_status: "pending_eligible",
    club_qualifying_order_id: order.id,
    club_revocation_reason: null,
  })

  if (!updated) return false

  await updateOrderClubMetadata(order, {
    club_membership_status: "pending_eligible",
    club_qualifying_order_id: order.id,
    club_qualifying_subtotal: qualifyingSubtotal,
  })

  return true
}

const clearOrderEligibility = async (
  order: ClubOrderRow,
  reason: string
): Promise<void> => {
  await updateOrderClubMetadata(order, {
    club_membership_status: "revoked",
    club_revocation_reason: reason,
  })
}

const findReplacementQualifyingOrder = async (
  userId: string,
  excludedOrderId: string
): Promise<ClubOrderRow | null> => {
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, user_id, status, fulfillment_status, payment_status, payment_method, subtotal, total, items, metadata, created_at"
    )
    .eq("user_id", userId)
    .neq("id", excludedOrderId)
    .not("status", "in", '("cancelled","failed")')
    .not("payment_status", "in", '("cancelled","failed","refunded")')
    .order("created_at", { ascending: true })

  if (error) {
    console.error(`[CLUB] Failed to find replacement order ${userId}:`, error)
    return null
  }

  const settings = await getClubSettings()
  if (!settings.is_active) return null

  for (const candidate of (data || []) as ClubOrderRow[]) {
    const subtotal = getEligibleItemSubtotal({
      items: candidate.items,
      fallbackSubtotal: candidate.subtotal ?? candidate.total,
    })

    if (
      subtotal >= settings.min_purchase_amount &&
      shouldActivateForCurrentState(candidate)
    ) {
      return candidate
    }
  }

  return null
}

export async function syncClubMembershipForOrder(
  orderId: string,
  reason = "order_state_changed"
): Promise<{ status: ClubMembershipStatus; activated: boolean }> {
  const order = await fetchOrderForClub(orderId)
  if (!order || !order.user_id) return { status: "none", activated: false }

  const settings = await getClubSettings()
  const qualifyingSubtotal = getEligibleItemSubtotal({
    items: order.items,
    fallbackSubtotal: order.subtotal ?? order.total,
  })

  if (!settings.is_active || qualifyingSubtotal < settings.min_purchase_amount) {
    return { status: "none", activated: false }
  }

  if (isInvalidOrder(order)) {
    await clearOrderEligibility(order, reason)
    await revokeOrReplaceMembership(order, reason)
    return { status: "revoked", activated: false }
  }

  if (shouldActivateForCurrentState(order)) {
    const activated = await activateMembershipForOrder(order, qualifyingSubtotal)
    return { status: activated ? "active" : "none", activated }
  }

  const pending = await markPendingEligible(order, qualifyingSubtotal)
  return { status: pending ? "pending_eligible" : "none", activated: false }
}

export async function revokeOrReplaceMembership(
  invalidOrder: ClubOrderRow | string,
  reason: string
): Promise<boolean> {
  const order =
    typeof invalidOrder === "string"
      ? await fetchOrderForClub(invalidOrder)
      : invalidOrder

  if (!order?.user_id) return false

  const supabase = await createAdminClient()
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_club_member, club_qualifying_order_id")
    .eq("id", order.user_id)
    .maybeSingle()

  const isRelatedQualifyingOrder =
    profile?.club_qualifying_order_id === order.id ||
    getOrderPricingMetadata(order.metadata).club_qualifying_order_id === order.id

  if (!isRelatedQualifyingOrder) {
    return false
  }

  const replacement = await findReplacementQualifyingOrder(order.user_id, order.id)
  if (replacement) {
    const subtotal = getEligibleItemSubtotal({
      items: replacement.items,
      fallbackSubtotal: replacement.subtotal ?? replacement.total,
    })
    return await activateMembershipForOrder(replacement, subtotal)
  }

  const revoked = await updateUserClubAudit(order.user_id, {
    is_club_member: false,
    club_member_since: null,
    club_membership_status: "revoked",
    club_qualifying_order_id: order.id,
    club_revocation_reason: reason,
  })

  if (revoked) {
    await clearOrderEligibility(order, reason)
  }

  return revoked
}

export async function deductClubSavingsFromOrder(orderId: string) {
  const adminSupabase = await createAdminClient()

  const { data: order, error: orderError } = await adminSupabase
    .from("orders")
    .select("user_id, metadata, items, total_amount, subtotal")
    .eq("id", orderId)
    .single()

  if (orderError || !order || !order.user_id) {
    console.error(
      `[CLUB] Order not found or no user associated for order ${orderId}:`,
      orderError
    )
    return
  }

  const metadata = getOrderPricingMetadata(order.metadata)
  if (metadata.club_savings_deducted) {
    return
  }

  const savingsToDeduct = getAppliedClubSavings({
    metadata: order.metadata,
    items: order.items,
  })

  if (savingsToDeduct <= 0) {
    return
  }

  const {
    data: { user },
    error: userError,
  } = await adminSupabase.auth.admin.getUserById(order.user_id)
  if (userError || !user) {
    console.error(
      `[CLUB] User not found for savings deduction (order ${orderId}):`,
      userError
    )
    return
  }

  const currentSavings = Number(user.user_metadata?.total_club_savings || 0)
  const newSavings = Math.max(0, currentSavings - savingsToDeduct)

  const { error: authError } = await adminSupabase.auth.admin.updateUserById(
    order.user_id,
    {
      user_metadata: {
        ...user.user_metadata,
        total_club_savings: newSavings,
      },
    }
  )
  if (authError) {
    console.error(
      `[CLUB] Failed to update auth metadata for user ${order.user_id}:`,
      authError
    )
  }

  const { error: profileError } = await adminSupabase
    .from("profiles")
    .update({
      total_club_savings: newSavings,
    })
    .eq("id", order.user_id)
  if (profileError) {
    console.error(
      `[CLUB] Failed to update profiles table for user ${order.user_id}:`,
      profileError
    )
  }

  const { error: metadataError } = await adminSupabase
    .from("orders")
    .update({
      metadata: {
        ...metadata,
        club_savings_deducted: true,
        deducted_amount: savingsToDeduct,
        deduction_date: new Date().toISOString(),
      },
    })
    .eq("id", orderId)
  if (metadataError) {
    console.error(
      `[CLUB] Failed to update order metadata for order ${orderId}:`,
      metadataError
    )
  }

  return newSavings
}
