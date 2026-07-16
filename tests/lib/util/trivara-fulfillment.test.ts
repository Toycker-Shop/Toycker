import { describe, expect, it } from "vitest"

import {
  getTrivaraFulfillmentMetadata,
  getTrivaraTrackingUrl,
  mergeTrivaraFulfillmentMetadata,
} from "@/lib/util/trivara-fulfillment"

describe("Trivara fulfillment metadata", () => {
  it("merges AWB details without removing existing order metadata", () => {
    const metadata = mergeTrivaraFulfillmentMetadata(
      { source: "checkout", trivara_fulfillment: { courierName: "Delhivery" } },
      {
        awb: "AWB123",
        shipmentStatus: "SHIPPED",
        syncedAt: "2026-07-16T10:00:00.000Z",
      }
    )

    expect(metadata.source).toBe("checkout")
    expect(getTrivaraFulfillmentMetadata(metadata)).toEqual({
      awb: "AWB123",
      courierName: "Delhivery",
      shipmentId: null,
      shipmentStatus: "SHIPPED",
      trackingUrl: null,
      syncedAt: "2026-07-16T10:00:00.000Z",
    })
  })

  it("builds a Trivara tracking link when only AWB is available", () => {
    expect(getTrivaraTrackingUrl(null, "AWB123")).toBe(
      "https://api-new.trivaralogistics.com/public-tracking/trivera/AWB123"
    )
  })
})