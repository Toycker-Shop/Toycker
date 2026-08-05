"use client"

import { GoogleTagManager } from "@next/third-parties/google"
import { usePathname } from "next/navigation"
import Script from "next/script"

const ADMIN_PATH_PREFIX = "/admin"

export function ThirdPartyAnalytics({ googleAnalyticsMeasurementId }: { googleAnalyticsMeasurementId: string | null }) {
  const pathname = usePathname()
  const gtmId = process.env.NEXT_PUBLIC_GTM_ID
  const contentsquareId = process.env.NEXT_PUBLIC_CONTENTSQUARE_ID
  const isAdmin = pathname?.startsWith(ADMIN_PATH_PREFIX)

  if (isAdmin) return null

  const hasGTM = Boolean(gtmId)
  const hasContentsquare = Boolean(contentsquareId)
  const hasGoogleAnalytics = Boolean(googleAnalyticsMeasurementId)

  if (!hasGTM && !hasContentsquare && !hasGoogleAnalytics) return null

  return (
    <>
      {hasGoogleAnalytics && googleAnalyticsMeasurementId && (
        <>
          <Script
            async
            src={`https://www.googletagmanager.com/gtag/js?id=${googleAnalyticsMeasurementId}`}
            strategy="afterInteractive"
          />
          <Script id="google-analytics-config" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || []; window.gtag = window.gtag || function(){window.dataLayer.push(arguments);}; window.gtag('js', new Date()); window.gtag('config', '${googleAnalyticsMeasurementId}', { send_page_view: true });`}
          </Script>
        </>
      )}
      {hasGTM && gtmId && <GoogleTagManager gtmId={gtmId} />}
      {hasContentsquare && contentsquareId && (
        <Script src={`https://t.contentsquare.net/uxa/${contentsquareId}.js`} strategy="lazyOnload" />
      )}
    </>
  )
}

export default ThirdPartyAnalytics