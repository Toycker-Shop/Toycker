export type TrivaraFulfillmentMetadata = {
  awb: string | null
  courierName: string | null
  shipmentId: string | null
  shipmentStatus: string | null
  trackingUrl: string | null
  syncedAt: string | null
}

const TRIVARA_FULFILLMENT_METADATA_KEY = "trivara_fulfillment"

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function getStringValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  return trimmed || null
}

export function getTrivaraFulfillmentMetadata(
  metadata: Record<string, unknown> | null | undefined
): TrivaraFulfillmentMetadata | null {
  const value = metadata?.[TRIVARA_FULFILLMENT_METADATA_KEY]

  if (!isRecord(value)) {
    return null
  }

  const details = {
    awb: getStringValue(value.awb),
    courierName: getStringValue(value.courierName),
    shipmentId: getStringValue(value.shipmentId),
    shipmentStatus: getStringValue(value.shipmentStatus),
    trackingUrl: getStringValue(value.trackingUrl),
    syncedAt: getStringValue(value.syncedAt),
  }

  return Object.values(details).some(Boolean) ? details : null
}

export function hasTrivaraFulfillmentDetails(
  details: Partial<TrivaraFulfillmentMetadata>
): boolean {
  return Boolean(
    details.awb ||
      details.courierName ||
      details.shipmentId ||
      details.shipmentStatus ||
      details.trackingUrl
  )
}

export function mergeTrivaraFulfillmentMetadata(
  metadata: Record<string, unknown> | null | undefined,
  details: Partial<TrivaraFulfillmentMetadata>
): Record<string, unknown> {
  const currentMetadata = metadata || {}
  const currentDetails = getTrivaraFulfillmentMetadata(currentMetadata)
  const nextDetails: TrivaraFulfillmentMetadata = {
    awb: details.awb ?? currentDetails?.awb ?? null,
    courierName: details.courierName ?? currentDetails?.courierName ?? null,
    shipmentId: details.shipmentId ?? currentDetails?.shipmentId ?? null,
    shipmentStatus: details.shipmentStatus ?? currentDetails?.shipmentStatus ?? null,
    trackingUrl: details.trackingUrl ?? currentDetails?.trackingUrl ?? null,
    syncedAt: details.syncedAt ?? currentDetails?.syncedAt ?? null,
  }

  return {
    ...currentMetadata,
    [TRIVARA_FULFILLMENT_METADATA_KEY]: nextDetails,
  }
}

export function getTrivaraTrackingUrl(
  details: TrivaraFulfillmentMetadata | null,
  fallbackAwb: string | null | undefined
): string | null {
  if (details?.trackingUrl) {
    return details.trackingUrl
  }

  const awb = details?.awb || fallbackAwb?.trim()
  return awb
    ? `https://api-new.trivaralogistics.com/public-tracking/trivera/${encodeURIComponent(awb)}`
    : null
}