import { getStorefrontMarketingConfig } from "@/lib/data/marketing"
import SiteAnalyticsInner from "./site-analytics-inner"

export default async function SiteAnalytics() {
  const config = await getStorefrontMarketingConfig()
  return <SiteAnalyticsInner config={config} />
}