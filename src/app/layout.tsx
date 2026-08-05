import { getBaseURL } from "@lib/util/env"
import { Metadata } from "next"
import NextTopLoader from "nextjs-toploader"
import Providers from "./providers"
import { grandstander, inter } from "@lib/fonts"
import SiteAnalytics from "@lib/analytics/site-analytics"
import MarketingVerificationMeta from "@/lib/marketing/marketing-verification-meta"
import "@/styles/globals.css"

export const metadata: Metadata = {
  title: {
    template: "%s | Toycker",
    default: "Toycker | Premium Toys & Collectibles",
  },
  description: "Shop the best selection of action figures, building sets, and educational toys at Toycker. Exclusive collections and free shipping on orders over ₹500.",
  keywords: ["toys", "action figures", "building blocks", "educational toys", "Toycker"],
  metadataBase: new URL(getBaseURL()),
  icons: {
    icon: "/favicon.png",
  },
  verification: {
    other: {
      "facebook-domain-verification": "yk2zyx544yueqnj36z8yigenhunfer",
    },
  },
}

export default function RootLayout(props: { children: React.ReactNode }) {
  // Removed server-side data fetching to enable static rendering
  // Auth and wishlist data now fetched client-side by providers
  return (
    <html lang="en" data-mode="light" suppressHydrationWarning className={`${grandstander.variable} ${inter.variable}`}>
      <head>
        <link rel="preconnect" href="https://cdn.toycker.in" crossOrigin="anonymous" />
        <MarketingVerificationMeta />
      </head>
      <body suppressHydrationWarning className="font-sans">
        <NextTopLoader color="#059669" showSpinner={false} height={3} />
        <Providers>
          {props.children}
        </Providers>
        <SiteAnalytics />
      </body>
    </html>
  )
}
