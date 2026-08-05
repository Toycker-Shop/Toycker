import AdminPageHeader from "@modules/admin/components/admin-page-header"
import MarketingSettings from "@modules/admin/components/marketing/marketing-settings"
import { getMarketingAdminSettings } from "@/lib/data/marketing"
import { getBaseURL } from "@/lib/util/env"

export default async function AdminMarketingPage() {
  const settings = await getMarketingAdminSettings()

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <AdminPageHeader title="Marketing" subtitle="Connect analytics, Meta tracking, Search Console, and product listings." />
      <MarketingSettings initialSettings={settings} merchantFeedUrl={`${getBaseURL()}/merchant-feed.xml`} />
    </div>
  )
}
