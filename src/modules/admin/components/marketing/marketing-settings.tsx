"use client"

import { useMemo, useState } from "react"
import { ChartBarIcon, CheckIcon, ClipboardDocumentIcon, GlobeAltIcon, MegaphoneIcon, ShoppingCartIcon } from "@heroicons/react/24/outline"
import AdminCard from "@modules/admin/components/admin-card"
import { useOptionalToast } from "@modules/common/context/toast-context"
import { saveMarketingIntegration, verifyMarketingIntegration } from "@/lib/data/marketing"
import type { MarketingAdminSetting, MarketingProvider, MarketingSettingsForm } from "@/lib/marketing/types"

type MarketingSettingsProps = { initialSettings: MarketingAdminSetting[]; merchantFeedUrl: string }
type FormState = Record<MarketingProvider, MarketingSettingsForm>
type MarketingAction = string

const toFormState = (settings: MarketingAdminSetting[]): FormState => {
  const byProvider = new Map(settings.map((setting) => [setting.provider, setting]))
  const get = (provider: MarketingProvider): MarketingAdminSetting => byProvider.get(provider) ?? {
    provider, enabled: false, measurementId: "", searchConsoleVerificationToken: "", pixelId: "", hasMetaAccessToken: false, metaTestEventCode: "", lastVerifiedAt: null, lastVerificationError: null,
  }
  return {
    google_analytics: { enabled: get("google_analytics").enabled, measurementId: get("google_analytics").measurementId },
    search_console: { enabled: get("search_console").enabled, searchConsoleVerificationToken: get("search_console").searchConsoleVerificationToken },
    meta: { enabled: get("meta").enabled, pixelId: get("meta").pixelId, metaAccessToken: "", metaTestEventCode: get("meta").metaTestEventCode },
    merchant_center: { enabled: get("merchant_center").enabled },
  }
}

function StatusText({ setting }: { setting: MarketingAdminSetting }) {
  if (setting.lastVerificationError) return <p className="text-xs text-red-600">{setting.lastVerificationError}</p>
  if (setting.lastVerifiedAt) return <p className="text-xs text-emerald-600">Setup checked successfully.</p>
  return <p className="text-xs text-gray-500">Not checked yet.</p>
}

export default function MarketingSettings({ initialSettings, merchantFeedUrl }: MarketingSettingsProps) {
  const [forms, setForms] = useState<FormState>(() => toFormState(initialSettings))
  const [pendingAction, setPendingAction] = useState<MarketingAction | null>(null)
  const [copied, setCopied] = useState(false)
  const toast = useOptionalToast()
  const settingMap = useMemo(() => new Map(initialSettings.map((setting) => [setting.provider, setting])), [initialSettings])

  const updateForm = (provider: MarketingProvider, update: Partial<MarketingSettingsForm>) => setForms((current) => ({ ...current, [provider]: { ...current[provider], ...update } }))

  const save = (provider: MarketingProvider, verify = false) => {
    const action: MarketingAction = provider + ":" + (verify ? "verify" : "save")
    if (pendingAction) return

    setPendingAction(action)
    void (async () => {
      try {
        await saveMarketingIntegration(provider, forms[provider])
        if (verify) {
          const result = await verifyMarketingIntegration(provider)
          toast?.showToast(result.message, result.ok ? "success" : "error")
        } else toast?.showToast("Marketing settings saved", "success")
      } catch (error) {
        toast?.showToast(error instanceof Error ? error.message : "Failed to save marketing settings", "error")
      } finally {
        setPendingAction(null)
      }
    })()
  }

  const copyFeedUrl = async () => {
    await navigator.clipboard.writeText(merchantFeedUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const analytics = settingMap.get("google_analytics")
  const searchConsole = settingMap.get("search_console")
  const meta = settingMap.get("meta")
  const merchant = settingMap.get("merchant_center")

  return (
    <div className="space-y-6">
      <AdminCard title="Google Analytics 4">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Add the Measurement ID from your Google web data stream. Ecommerce events will be sent automatically.</p>
          <Field label="Measurement ID" value={forms.google_analytics.measurementId ?? ""} placeholder="G-XXXXXXXXXX" onChange={(value) => updateForm("google_analytics", { measurementId: value })} />
          <Toggle checked={forms.google_analytics.enabled} onChange={(enabled) => updateForm("google_analytics", { enabled })} label="Enable Google Analytics" />
          {analytics && <StatusText setting={analytics} />}
          <Actions provider="google_analytics" pendingAction={pendingAction} onSave={() => save("google_analytics")} onVerify={() => save("google_analytics", true)} />
        </div>
      </AdminCard>
      <AdminCard title="Google Search Console">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Paste the content value from Search Console HTML-tag verification. The tag will be published on storefront pages.</p>
          <Field label="Verification token" value={forms.search_console.searchConsoleVerificationToken ?? ""} placeholder="Paste the token only" onChange={(value) => updateForm("search_console", { searchConsoleVerificationToken: value })} />
          <Toggle checked={forms.search_console.enabled} onChange={(enabled) => updateForm("search_console", { enabled })} label="Publish verification tag" />
          {searchConsole && <StatusText setting={searchConsole} />}
          <Actions provider="search_console" pendingAction={pendingAction} onSave={() => save("search_console")} onVerify={() => save("search_console", true)} />
        </div>
      </AdminCard>
      <AdminCard title="Meta Pixel and Conversions API">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Browser events and confirmed purchases will be sent to Meta. The access token stays on the server.</p>
          <Field label="Pixel ID" value={forms.meta.pixelId ?? ""} placeholder="Numeric Pixel ID" onChange={(value) => updateForm("meta", { pixelId: value })} />
          <Field label="Access token" type="password" value={forms.meta.metaAccessToken ?? ""} placeholder={meta?.hasMetaAccessToken ? "Saved token; leave blank to keep it" : "Paste access token"} onChange={(value) => updateForm("meta", { metaAccessToken: value })} />
          <Field label="Test Event Code (optional)" value={forms.meta.metaTestEventCode ?? ""} placeholder="From Meta Events Manager" onChange={(value) => updateForm("meta", { metaTestEventCode: value })} />
          <Toggle checked={forms.meta.enabled} onChange={(enabled) => updateForm("meta", { enabled })} label="Enable Meta tracking" />
          {meta && <StatusText setting={meta} />}
          <Actions provider="meta" pendingAction={pendingAction} onSave={() => save("meta")} onVerify={() => save("meta", true)} />
        </div>
      </AdminCard>
      <AdminCard title="Google Merchant Center">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Merchant Center can fetch this public product feed on a schedule. No Google credential is required for this prototype.</p>
          <div className="flex gap-2"><input value={merchantFeedUrl} readOnly className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm" /><button type="button" onClick={copyFeedUrl} className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white">{copied ? <CheckIcon className="h-4 w-4" /> : <ClipboardDocumentIcon className="h-4 w-4" />}{copied ? "Copied" : "Copy"}</button></div>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-600"><li>Open Merchant Center and go to Data sources.</li><li>Add products from a file using Scheduled fetch.</li><li>Paste the feed URL and enable free listings.</li></ol>
          {merchant && <StatusText setting={merchant} />}
          <Actions provider="merchant_center" pendingAction={pendingAction} onSave={() => save("merchant_center")} onVerify={() => save("merchant_center", true)} />
        </div>
      </AdminCard>
      <div className="grid grid-cols-2 gap-3 text-xs text-gray-500 sm:grid-cols-4"><Info icon={ChartBarIcon} label="GA4 ecommerce" /><Info icon={GlobeAltIcon} label="Search verification" /><Info icon={MegaphoneIcon} label="Meta events" /><Info icon={ShoppingCartIcon} label="Product feed" /></div>
    </div>
  )
}

function Field({ label, value, placeholder, type = "text", onChange }: { label: string; value: string; placeholder: string; type?: "text" | "password"; onChange: (_value: string) => void }) {
  return <label className="block text-sm font-medium text-gray-700">{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (_value: boolean) => void; label: string }) {
  return <label className="flex items-center gap-3 text-sm font-medium text-gray-700"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded border-gray-300" />{label}</label>
}

function Actions({ provider, pendingAction, onSave, onVerify }: { provider: MarketingProvider; pendingAction: MarketingAction | null; onSave: () => void; onVerify: () => void }) {
  const saveAction: MarketingAction = provider + ":save"
  const verifyAction: MarketingAction = provider + ":verify"
  const isSavePending = pendingAction === saveAction
  const isVerifyPending = pendingAction === verifyAction
  const isAnotherActionPending = pendingAction !== null && !isSavePending && !isVerifyPending

  return <div className="flex gap-2"><button type="button" disabled={isAnotherActionPending || isSavePending || isVerifyPending} onClick={onSave} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{isSavePending ? "Saving..." : "Save"}</button><button type="button" disabled={isAnotherActionPending || isSavePending || isVerifyPending} onClick={onVerify} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50">{isVerifyPending ? "Checking..." : "Save and check"}</button></div>
}

function Info({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2"><Icon className="h-4 w-4" />{label}</div>
}
