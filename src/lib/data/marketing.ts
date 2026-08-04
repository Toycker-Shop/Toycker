"use server"

import { revalidatePath, revalidateTag, unstable_cache } from "next/cache"
import { z } from "zod"

import { PERMISSIONS } from "@/lib/permissions"
import { requirePermission } from "@/lib/permissions/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getBaseURL } from "@/lib/util/env"
import { MARKETING_PROVIDERS, type MarketingAdminSetting, type MarketingProvider, type MarketingSettingsForm, type StorefrontMarketingConfig } from "@/lib/marketing/types"

type MarketingIntegrationRow = {
  provider: MarketingProvider
  enabled: boolean
  measurement_id: string | null
  search_console_verification_token: string | null
  pixel_id: string | null
  meta_access_token: string | null
  meta_test_event_code: string | null
  last_verified_at: string | null
  last_verification_error: string | null
  updated_at: string
}
const settingsSchema = z.object({
  enabled: z.boolean(),
  measurementId: z.string().trim().optional(),
  searchConsoleVerificationToken: z.string().trim().optional(),
  pixelId: z.string().trim().optional(),
  metaAccessToken: z.string().trim().optional(),
  metaTestEventCode: z.string().trim().optional(),
})

const providerSchema = z.enum(MARKETING_PROVIDERS)

const emptySetting = (provider: MarketingProvider): MarketingAdminSetting => ({
  provider,
  enabled: false,
  measurementId: "",
  searchConsoleVerificationToken: "",
  pixelId: "",
  hasMetaAccessToken: false,
  metaTestEventCode: "",
  lastVerifiedAt: null,
  lastVerificationError: null,
})

const toAdminSetting = (row: MarketingIntegrationRow): MarketingAdminSetting => ({
  provider: row.provider,
  enabled: row.enabled,
  measurementId: row.measurement_id ?? "",
  searchConsoleVerificationToken: row.search_console_verification_token ?? "",
  pixelId: row.pixel_id ?? "",
  hasMetaAccessToken: Boolean(row.meta_access_token),
  metaTestEventCode: row.meta_test_event_code ?? "",
  lastVerifiedAt: row.last_verified_at,
  lastVerificationError: row.last_verification_error,
})

export async function getMarketingAdminSettings(): Promise<MarketingAdminSetting[]> {
  await requirePermission(PERMISSIONS.SETTINGS_READ)
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("marketing_integrations")
    .select(
      "provider, enabled, measurement_id, search_console_verification_token, pixel_id, meta_access_token, meta_test_event_code, last_verified_at, last_verification_error, updated_at"
    )

  if (error) {
    throw new Error(`Failed to load marketing settings: ${error.message}`)
  }

  const rows = (data ?? []) as MarketingIntegrationRow[]
  const rowMap = new Map(rows.map((row) => [row.provider, row]))

  return MARKETING_PROVIDERS.map((provider) => {
    const row = rowMap.get(provider)
    return row ? toAdminSetting(row) : emptySetting(provider)
  })
}

const loadStorefrontMarketingConfig = async (): Promise<StorefrontMarketingConfig> => {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("marketing_integrations")
    .select(
      "provider, enabled, measurement_id, search_console_verification_token, pixel_id"
    )
    .in("provider", ["google_analytics", "search_console", "meta"])

  const rows = (data ?? []) as Array<
    Pick<
      MarketingIntegrationRow,
      "provider" | "enabled" | "measurement_id" | "search_console_verification_token" | "pixel_id"
    >
  >
  const rowMap = new Map(rows.map((row) => [row.provider, row]))
  const analytics = rowMap.get("google_analytics")
  const searchConsole = rowMap.get("search_console")
  const meta = rowMap.get("meta")
  const envMetaPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() || null

  return {
    googleAnalyticsMeasurementId:
      analytics?.enabled && analytics.measurement_id
        ? analytics.measurement_id
        : null,
    metaPixelId:
      meta?.enabled && meta.pixel_id ? meta.pixel_id : envMetaPixelId,
    searchConsoleVerificationToken:
      searchConsole?.enabled && searchConsole.search_console_verification_token
        ? searchConsole.search_console_verification_token
        : null,
    metaEnabled: Boolean(meta?.enabled && meta.pixel_id) || Boolean(envMetaPixelId),
    merchantFeedUrl: `${getBaseURL()}/merchant-feed.xml`,
  }
}

export const getStorefrontMarketingConfig = async () =>
  unstable_cache(
    loadStorefrontMarketingConfig,
    ["storefront-marketing-config"],
    { revalidate: 300, tags: ["marketing_integrations"] }
  )()

const normalizeOptional = (value: string | undefined): string | null => {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

export async function saveMarketingIntegration(
  providerInput: MarketingProvider,
  formInput: MarketingSettingsForm
): Promise<void> {
  await requirePermission(PERMISSIONS.SETTINGS_UPDATE)
  const provider = providerSchema.parse(providerInput)
  const form = settingsSchema.parse(formInput)
  const supabase = await createAdminClient()

  const { data: existingData } = await supabase
    .from("marketing_integrations")
    .select("meta_access_token")
    .eq("provider", provider)
    .maybeSingle()

  const existing = existingData as { meta_access_token?: string | null } | null
  const metaAccessToken =
    provider === "meta" && !form.metaAccessToken?.trim()
      ? existing?.meta_access_token ?? null
      : normalizeOptional(form.metaAccessToken)

  const { error } = await supabase.from("marketing_integrations").upsert(
    {
      provider,
      enabled: form.enabled,
      measurement_id: normalizeOptional(form.measurementId),
      search_console_verification_token: normalizeOptional(
        form.searchConsoleVerificationToken
      ),
      pixel_id: normalizeOptional(form.pixelId),
      meta_access_token: metaAccessToken,
      meta_test_event_code: normalizeOptional(form.metaTestEventCode),
      last_verification_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider" }
  )

  if (error) {
    throw new Error(`Failed to save marketing settings: ${error.message}`)
  }

  revalidateTag("marketing_integrations", "max")
  revalidatePath("/admin/marketing")
}

export type MarketingVerificationResult = {
  ok: boolean
  message: string
}

export async function verifyMarketingIntegration(
  providerInput: MarketingProvider
): Promise<MarketingVerificationResult> {
  await requirePermission(PERMISSIONS.SETTINGS_UPDATE)
  const provider = providerSchema.parse(providerInput)
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("marketing_integrations")
    .select(
      "provider, enabled, measurement_id, search_console_verification_token, pixel_id, meta_access_token, meta_test_event_code"
    )
    .eq("provider", provider)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to verify marketing settings: ${error.message}`)
  }

  const row = data as Partial<MarketingIntegrationRow> | null
  let message = "Saved. Complete the provider verification steps shown below."
  let ok = true

  if (provider === "google_analytics") {
    ok = /^G-[A-Z0-9]+$/i.test(row?.measurement_id ?? "")
    message = ok
      ? "Measurement ID format looks correct. Check Google Analytics Realtime after visiting the storefront."
      : "Enter a valid GA4 Measurement ID beginning with G-."
  }

  if (provider === "search_console") {
    ok = Boolean(row?.search_console_verification_token?.trim())
    message = ok
      ? "The verification tag is published. Open Search Console and click Verify."
      : "Enter the verification token from Search Console."
  }

  if (provider === "meta") {
    ok = /^\d+$/.test(row?.pixel_id ?? "") && Boolean(row?.meta_access_token)
    message = ok
      ? row?.meta_test_event_code
        ? "Credentials are present. Check the test event in Meta Events Manager."
        : "Credentials are present. Add a Test Event Code to verify without creating a live event."
      : "Enter the numeric Pixel ID and Meta access token."
  }

  if (provider === "merchant_center") {
    message = "The feed is generated at /merchant-feed.xml. Add it in Merchant Center using Scheduled fetch."
  }

  await supabase
    .from("marketing_integrations")
    .update({
      last_verified_at: ok ? new Date().toISOString() : null,
      last_verification_error: ok ? null : message,
      updated_at: new Date().toISOString(),
    })
    .eq("provider", provider)

  revalidateTag("marketing_integrations", "max")
  revalidatePath("/admin/marketing")
  return { ok, message }
}
