import { getStorefrontMarketingConfig } from "@/lib/data/marketing"

export default async function MarketingVerificationMeta() {
  const config = await getStorefrontMarketingConfig()
  if (!config.searchConsoleVerificationToken) return null

  return <meta name="google-site-verification" content={config.searchConsoleVerificationToken} />
}
