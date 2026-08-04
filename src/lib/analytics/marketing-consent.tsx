import type { ReactNode } from "react"

/**
 * Marketing tracking wrapper.
 *
 * Consent is intentionally disabled for the current Toycker prototype. The
 * storefront should load Google and Meta marketing tracking by default, so
 * this component currently renders its children without showing a banner,
 * reading localStorage, or blocking any scripts.
 *
 * The wrapper is kept so consent can be enabled again without changing the
 * analytics composition in site-analytics-inner.tsx. To restore consent,
 * add the visitor-choice state, storage handling, and Allow/Reject UI here,
 * then render the children only after the visitor has allowed tracking.
 * Admin-route exclusion remains handled by the analytics components.
 */
export default function MarketingConsent({
  children,
}: {
  children: ReactNode
}) {
  return children
}