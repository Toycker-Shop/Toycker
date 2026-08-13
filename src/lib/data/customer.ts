"use server"

import { cache } from "react"
import { createClient } from "@/lib/supabase/server"
import { revalidateTag, revalidatePath } from "next/cache"
import { getAuthUser } from "./auth"
import { redirect } from "next/navigation"
import { removeCartId } from "./cookies"
import { INDIAN_PINCODE_ERROR, isValidIndianPincode } from "@/lib/util/indian-pincode"
import { CustomerProfile, Address } from "@/lib/supabase/types"
import { getCustomerFacingEmail } from "@/lib/util/customer-email"
import { getCheckoutPhoneValue } from "@/lib/util/customer-phone"
import { resolveCustomerPhone } from "@/lib/util/customer-contact-phone"

type CustomerProfilePhoneRow = {
  phone: string | null
}

type CustomerAddressFlagsRow = {
  is_default_billing: boolean | null
  is_default_shipping: boolean | null
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim()
  return trimmedValue ? trimmedValue : null
}

function getBooleanFormValue(formData: FormData, key: string): boolean | null {
  if (!formData.has(key)) {
    return null
  }

  return formData.get(key) === "true"
}

async function resolveImmutableCustomerPhone(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: NonNullable<Awaited<ReturnType<typeof getAuthUser>>>
): Promise<string | null> {
  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("phone")
    .eq("id", user.id)
    .maybeSingle<CustomerProfilePhoneRow>()

  if (profileError) {
    console.warn("Failed to resolve customer phone for address sync:", profileError)
  }

  const resolvedAccountPhone = resolveCustomerPhone({
    profilePhone: profileRow?.phone ?? null,
    userMetadata: user.user_metadata,
    authPhone: user.phone ?? null,
  })

  return normalizeOptionalString(getCheckoutPhoneValue(resolvedAccountPhone))
}

export const retrieveCustomer = cache(
  async (): Promise<CustomerProfile | null> => {
    const user = await getAuthUser()
    const supabase = await createClient()

    if (!user) {
      return null
    }

    const { data: addresses } = await supabase
      .from("addresses")
      .select(
        "id, first_name, last_name, address_1, address_2, city, province, postal_code, country_code, phone, company, is_default_billing, is_default_shipping"
      )
      .order("is_default_billing", { ascending: false })
      .order("is_default_shipping", { ascending: false })
      .eq("user_id", user.id)

    const { data: profile } = await supabase
      .from("profiles")
      .select(
        "first_name, last_name, phone, email, contact_email, is_club_member, club_member_since, club_membership_status, club_qualifying_order_id, club_revocation_reason, total_club_savings"
      )
      .eq("id", user.id)
      .single()

    return {
      id: user.id,
      email:
        getCustomerFacingEmail(
          profile?.contact_email,
          profile?.email,
          user.email
        ) || "",
      first_name: profile?.first_name || user.user_metadata?.first_name || "",
      last_name: profile?.last_name || user.user_metadata?.last_name || "",
      phone:
        profile?.phone ||
        user.user_metadata?.phone_number ||
        user.user_metadata?.phone ||
        user.phone ||
        "",
      created_at: user.created_at,
      addresses: (addresses as Address[]) || [],
      is_club_member:
        profile?.is_club_member ?? user.user_metadata?.is_club_member ?? false,
      club_member_since:
        profile?.club_member_since ??
        user.user_metadata?.club_member_since ??
        null,
      club_membership_status:
        profile?.club_membership_status ??
        user.user_metadata?.club_membership_status ??
        (profile?.is_club_member ? "active" : "none"),
      club_qualifying_order_id:
        profile?.club_qualifying_order_id ??
        user.user_metadata?.club_qualifying_order_id ??
        null,
      club_revocation_reason:
        profile?.club_revocation_reason ??
        user.user_metadata?.club_revocation_reason ??
        null,
      total_club_savings: Number(
        profile?.total_club_savings ?? user.user_metadata?.total_club_savings ?? 0
      ),
    }
  }
)

export async function signout() {
  const supabase = await createClient()
  await supabase.auth.signOut()

  await removeCartId()

  revalidateTag("customers", "max")
  revalidateTag("cart", "max")
  redirect("/account")
}

export async function updateCustomer(data: Partial<CustomerProfile>) {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    throw new Error("Not authenticated")
  }

  const { email, phone: _ignoredPhone, ...metadataPatch } = data
  const normalizedEmail = email?.trim() || null

  const { error: updateError } = await supabase.auth.updateUser({
    data: {
      ...user.user_metadata,
      ...metadataPatch,
    },
  })

  if (updateError) {
    throw updateError
  }

  if (email !== undefined) {
    const { error: profileUpdateError } = await supabase
      .from("profiles")
      .update({ contact_email: normalizedEmail })
      .eq("id", user.id)

    if (profileUpdateError) {
      throw profileUpdateError
    }
  }

  revalidateTag("customers", "max")
  revalidateTag("admin-customers", "max")
  revalidatePath("/", "layout")
  revalidatePath("/admin/customers", "layout")
}

export async function addCustomerAddress(
  _currentState: unknown,
  formData: FormData
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: "Not authenticated" }
  }

  // Trimming inputs
  const postalCode = formData.get("postal_code")
  if (
    typeof postalCode !== "string" ||
    !isValidIndianPincode(postalCode)
  ) {
    return { success: false, error: INDIAN_PINCODE_ERROR }
  }

  const first_name = ((formData.get("first_name") as string) || "").trim()
  const last_name = ((formData.get("last_name") as string) || "").trim()

  const address = {
    user_id: user.id,
    first_name,
    last_name,
    company: ((formData.get("company") as string) || "").trim(),
    address_1: ((formData.get("address_1") as string) || "").trim(),
    address_2: ((formData.get("address_2") as string) || "").trim(),
    city: ((formData.get("city") as string) || "").trim(),
    country_code: ((formData.get("country_code") as string) || "")
      .trim()
      .toLowerCase(),
    province: ((formData.get("province") as string) || "").trim(),
    postal_code: postalCode,
    phone: ((formData.get("phone") as string) || "").trim(),
    is_default_billing: formData.get("isDefaultBilling") === "true",
    is_default_shipping: formData.get("isDefaultShipping") === "true",
  }

  // If adding a billing address through the profile and user has no addresses, make it default
  const { count } = await supabase
    .from("addresses")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)

  if (count === 0) {
    address.is_default_billing = true
  }

  if (address.is_default_billing) {
    const immutableCustomerPhone = await resolveImmutableCustomerPhone(
      supabase,
      user
    )

    if (immutableCustomerPhone) {
      address.phone = immutableCustomerPhone
    }
  }

  const { error } = await supabase.from("addresses").insert(address)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidateTag("customers", "max")
  revalidatePath("/", "layout")
  return { success: true, error: null }
}

export async function updateCustomerAddress(
  _currentState: unknown,
  formData: FormData
) {
  const supabase = await createClient()
  const addressId = formData.get("addressId") as string
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: "Not authenticated" }
  }

  const postalCode = formData.get("postal_code")
  if (
    typeof postalCode !== "string" ||
    !isValidIndianPincode(postalCode)
  ) {
    return { success: false, error: INDIAN_PINCODE_ERROR }
  }

  const { data: existingAddress, error: existingAddressError } = await supabase
    .from("addresses")
    .select("is_default_billing, is_default_shipping")
    .eq("id", addressId)
    .eq("user_id", user.id)
    .maybeSingle<CustomerAddressFlagsRow>()

  if (existingAddressError) {
    return { success: false, error: existingAddressError.message }
  }

  if (!existingAddress) {
    return { success: false, error: "Address not found" }
  }

  const nextIsDefaultBilling =
    getBooleanFormValue(formData, "isDefaultBilling") ??
    Boolean(existingAddress.is_default_billing)
  const nextIsDefaultShipping =
    getBooleanFormValue(formData, "isDefaultShipping") ??
    Boolean(existingAddress.is_default_shipping)

  const address = {
    first_name: ((formData.get("first_name") as string) || "").trim(),
    last_name: ((formData.get("last_name") as string) || "").trim(),
    company: ((formData.get("company") as string) || "").trim(),
    address_1: ((formData.get("address_1") as string) || "").trim(),
    address_2: ((formData.get("address_2") as string) || "").trim(),
    city: ((formData.get("city") as string) || "").trim(),
    country_code: ((formData.get("country_code") as string) || "")
      .trim()
      .toLowerCase(),
    province: ((formData.get("province") as string) || "").trim(),
    postal_code: postalCode,
    phone: ((formData.get("phone") as string) || "").trim(),
    is_default_billing: nextIsDefaultBilling,
    is_default_shipping: nextIsDefaultShipping,
  }

  if (nextIsDefaultBilling) {
    const immutableCustomerPhone = await resolveImmutableCustomerPhone(
      supabase,
      user
    )

    if (immutableCustomerPhone) {
      address.phone = immutableCustomerPhone
    }
  }

  const { error } = await supabase
    .from("addresses")
    .update(address)
    .eq("id", addressId)
    .eq("user_id", user.id)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidateTag("customers", "max")
  revalidatePath("/", "layout")
  return { success: true, error: null }
}

export async function deleteCustomerAddress(addressId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("addresses")
    .delete()
    .eq("id", addressId)

  if (error) {
    throw error
  }

  revalidateTag("customers", "max")
}
