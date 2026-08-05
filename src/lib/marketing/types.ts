export const MARKETING_PROVIDERS = [
  "google_analytics",
  "search_console",
  "meta",
  "merchant_center",
] as const

export type MarketingProvider = (typeof MARKETING_PROVIDERS)[number]

export type MarketingSettingsForm = {
  enabled: boolean
  measurementId?: string
  searchConsoleVerificationToken?: string
  pixelId?: string
  metaAccessToken?: string
  metaTestEventCode?: string
}

export type MarketingAdminSetting = {
  provider: MarketingProvider
  enabled: boolean
  measurementId: string
  searchConsoleVerificationToken: string
  pixelId: string
  hasMetaAccessToken: boolean
  metaTestEventCode: string
  lastVerifiedAt: string | null
  lastVerificationError: string | null
}

export type StorefrontMarketingConfig = {
  googleAnalyticsMeasurementId: string | null
  metaPixelId: string | null
  searchConsoleVerificationToken: string | null
  metaEnabled: boolean
  merchantFeedUrl: string
}
