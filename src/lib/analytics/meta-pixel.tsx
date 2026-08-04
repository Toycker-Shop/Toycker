"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import Script from "next/script"

const META_PIXEL_BASE_SCRIPT_ID = "meta-pixel-base"
const ADMIN_PATH_PREFIX = "/admin"

type MetaPixelFn = (_command: "init" | "track", ..._args: unknown[]) => void
type MetaPixelWindow = Window & { fbq?: MetaPixelFn; _fbq?: MetaPixelFn }

const getMetaPixelWindow = (): MetaPixelWindow => window as MetaPixelWindow

export const isMetaPixelRouteEnabled = (pathname: string | null): boolean => {
  if (!pathname) return false
  return !pathname.startsWith(ADMIN_PATH_PREFIX)
}

const buildMetaPixelScript = (pixelId: string): string => `
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${pixelId}');
fbq('track', 'PageView');
`

export default function MetaPixel({ pixelId, enabled }: { pixelId: string | null; enabled: boolean }) {
  const pathname = usePathname()
  const hasTrackedInitialPage = useRef(false)
  const hasPixelId = enabled && Boolean(pixelId)
  const isEnabledRoute = isMetaPixelRouteEnabled(pathname)

  useEffect(() => {
    if (!hasPixelId || !isEnabledRoute) return
    if (!hasTrackedInitialPage.current) {
      hasTrackedInitialPage.current = true
      return
    }
    getMetaPixelWindow().fbq?.("track", "PageView")
  }, [hasPixelId, isEnabledRoute, pathname])

  if (!hasPixelId || !isEnabledRoute || !pixelId) return null

  return (
    <>
      <Script id={META_PIXEL_BASE_SCRIPT_ID} strategy="afterInteractive">
        {buildMetaPixelScript(pixelId)}
      </Script>
      <noscript>
        <img alt="" height="1" width="1" style={{ display: "none" }} src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`} />
      </noscript>
    </>
  )
}