"use client"

import { Analytics as VercelAnalytics } from "@vercel/analytics/next"
import { SpeedInsights } from "@vercel/speed-insights/next"

import ThirdPartyAnalytics from "@lib/analytics"
import MetaPixel from "@lib/analytics/meta-pixel"
import MarketingConsent from "@lib/analytics/marketing-consent"
import type { StorefrontMarketingConfig } from "@/lib/marketing/types"

export default function SiteAnalyticsInner({ config }: { config: StorefrontMarketingConfig }) {
  const isProduction = process.env.NODE_ENV === "production"

  return (
    <>
      <MarketingConsent>
        <ThirdPartyAnalytics googleAnalyticsMeasurementId={config.googleAnalyticsMeasurementId} />
        <MetaPixel pixelId={config.metaPixelId} enabled={config.metaEnabled} />
      </MarketingConsent>
      {isProduction && (
        <>
          <SpeedInsights />
          <VercelAnalytics />
        </>
      )}
    </>
  )
}