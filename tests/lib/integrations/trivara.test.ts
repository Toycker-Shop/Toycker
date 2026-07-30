import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  buildTrivaraNewOrderPayload,
  extractTrivaraApiOrderId,
  extractTrivaraExternalOrderId,
  extractToyckerOrderIdFromTrivaraExternalId,
  extractTrivaraOrderId,
  extractTrivaraOrderStatus,
  extractTrivaraMerchantId,
  extractTrivaraWebhookEventName,
  extractTrivaraShipmentDetails,
  getTrivaraNewApiConfig,
  getTrivaraResponseBusinessError,
  sendTrivaraCancelNewOrder,
  sendTrivaraGetOrder,
  sendTrivaraGetShipment,
  sendTrivaraNewOrder,
  TrivaraNewApiConfig,
} from "@/lib/integrations/trivara"
import { Order } from "@/lib/supabase/types"
import {
  getTrivaraWebhookAuthToken,
  verifyTrivaraWebhookAuthorization,
} from "@/lib/integrations/trivara-webhook"

const newOrderConfig: Pick<
  TrivaraNewApiConfig,
  | "pickupAddressId"
  | "channelName"
  | "defaultWeightKg"
  | "defaultLengthCm"
  | "defaultWidthCm"
  | "defaultHeightCm"
> = {
  pickupAddressId: "pickup-123",
  channelName: "Toycker",
  defaultWeightKg: 0.5,
  defaultLengthCm: 20,
  defaultWidthCm: 15,
  defaultHeightCm: 10,
}

const authConfig: Pick<
  TrivaraNewApiConfig,
  "apiBaseUrl" | "apiKeyId" | "apiSecret"
> = {
  apiBaseUrl: "https://api-new.trivaralogistics.com",
  apiKeyId: "key-id-1",
  apiSecret: "secret-1",
}

const buildOrder = (overrides: Partial<Order> = {}): Order => ({
  id: "order-1",
  user_id: "user-1",
  display_id: 1223,
  customer_email: "buyer@example.com",
  email: "buyer@example.com",
  promo_code: null,
  total_amount: 2500,
  currency_code: "inr",
  status: "order_placed",
  fulfillment_status: "not_shipped",
  payment_status: "pending",
  payu_txn_id: null,
  gateway_txn_id: null,
  shipping_address: {
    first_name: "Customer",
    last_name: "Name",
    company: null,
    address_1: "Shop No 1",
    address_2: "Prabhunagar, Hirabag Circle",
    city: "Surat",
    province: "Gujarat",
    country_code: "in",
    postal_code: "395006",
    phone: "+91 98989 89898",
  },
  billing_address: null,
  shipping_method: null,
  shipping_methods: [],
  shipping_partner_id: null,
  shipping_partner: null,
  tracking_number: null,
  payment_method: "cash_on_delivery",
  payment_collection: null,
  metadata: null,
  created_at: "2026-04-28T00:00:00.000Z",
  updated_at: "2026-04-28T00:00:00.000Z",
  items: [
    {
      id: "item-1",
      cart_id: "cart-1",
      product_id: "prod-1",
      variant_id: "var-1",
      quantity: 1,
      created_at: "2026-04-28T00:00:00.000Z",
      updated_at: "2026-04-28T00:00:00.000Z",
      title: "Toy Car",
      product_title: "Toy Car",
      unit_price: 2500,
      total: 2500,
    },
  ],
  total: 2500,
  subtotal: 2500,
  tax_total: 0,
  shipping_total: 0,
  discount_total: 0,
  gift_card_total: 0,
  payment_collections: [],
  ...overrides,
})

describe("Trivara new dashboard integration", () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })


  it("extracts Toycker external order IDs from nested webhook payloads", () => {
    const payload = {
      event: "order.updated",
      data: {
        order: {
          externalOrderId: "toycker_274fa7f8-8153-40e9-9881-70afe97e541d",
        },
      },
    }

    const externalOrderId = extractTrivaraExternalOrderId(payload)

    expect(externalOrderId).toBe(
      "toycker_274fa7f8-8153-40e9-9881-70afe97e541d"
    )
    expect(extractToyckerOrderIdFromTrivaraExternalId(externalOrderId)).toBe(
      "274fa7f8-8153-40e9-9881-70afe97e541d"
    )
  })

  it("keeps unprefixed external order IDs usable for webhook matching", () => {
    expect(
      extractToyckerOrderIdFromTrivaraExternalId(
        "274fa7f8-8153-40e9-9881-70afe97e541d"
      )
    ).toBe("274fa7f8-8153-40e9-9881-70afe97e541d")
  })

  it("extracts Trivara webhook identifiers from alternate field names", () => {
    const payload = {
      eventType: "order.shipped",
      merchant_id: "merchant-1",
      data: {
        seller_order_id: "toycker_ord_1275ce87-4a72-453d-86a7-4fb2b7edf612",
        trivaraOrderId: "TRV-000007",
        trivaraApiOrderId: "cms4acq1u00522gpczleou6nm",
      },
    }

    expect(extractTrivaraWebhookEventName(payload)).toBe("order.shipped")
    expect(extractTrivaraMerchantId(payload)).toBe("merchant-1")
    expect(extractTrivaraExternalOrderId(payload)).toBe(
      "toycker_ord_1275ce87-4a72-453d-86a7-4fb2b7edf612"
    )
    expect(extractTrivaraOrderId(payload)).toBe("TRV-000007")
    expect(extractTrivaraApiOrderId(payload)).toBe(
      "cms4acq1u00522gpczleou6nm"
    )
  })
  it("builds a New Order COD payload from Toycker order data", () => {
    const payload = buildTrivaraNewOrderPayload(buildOrder(), newOrderConfig)

    expect(payload).toMatchObject({
      customerName: "Customer Name",
      customerPhone: "9898989898",
      addressLine1: "Shop No 1",
      addressLine2: "Prabhunagar, Hirabag Circle",
      pincode: "395006",
      city: "Surat",
      state: "Gujarat",
      paymentMode: "COD",
      codAmount: 2500,
      shippingCharges: 0,
      discount: 0,
      pickupAddressId: "pickup-123",
      customerEmail: "buyer@example.com",
      country: "IN",
      dimensions: "20x15x10",
      channelName: "Toycker",
      externalOrderId: "toycker_order-1",
      items: [
        {
          name: "Toy Car",
          quantity: 1,
          price: 2500,
          sku: "1223-1",
          weight: 0.5,
          category: "Toys",
          lengthCm: 20,
          widthCm: 15,
          heightCm: 10,
        },
      ],
    })
  })
  it("sends COD final total, shipping, and decimal item prices to Trivara", () => {
    const payload = buildTrivaraNewOrderPayload(
      buildOrder({
        total_amount: 134.05,
        total: 134.05,
        subtotal: 94.05,
        shipping_total: 40,
        discount_total: 0,
        items: [
          {
            ...buildOrder().items![0],
            title: "MINI MOSTER TRUCKS",
            product_title: "MINI MOSTER TRUCKS",
            unit_price: 94.05,
            total: 94.05,
            quantity: 1,
          },
        ],
      }),
      newOrderConfig
    )

    expect(payload).toMatchObject({
      paymentMode: "COD",
      codAmount: 134.05,
      shippingCharges: 40,
      discount: 0,
      items: [
        {
          name: "MINI MOSTER TRUCKS",
          quantity: 1,
          price: 94.05,
        },
      ],
    })
  })

  it("uses item unit price instead of line total when quantity is greater than one", () => {
    const payload = buildTrivaraNewOrderPayload(
      buildOrder({
        total_amount: 228.1,
        total: 228.1,
        subtotal: 188.1,
        shipping_total: 40,
        items: [
          {
            ...buildOrder().items![0],
            quantity: 2,
            unit_price: 94.05,
            total: 188.1,
          },
        ],
      }),
      newOrderConfig
    )

    expect(payload).toMatchObject({
      codAmount: 228.1,
      shippingCharges: 40,
      items: [
        {
          quantity: 2,
          price: 94.05,
        },
      ],
    })
  })

  it("sends order-level discounts separately from the COD collection amount", () => {
    const payload = buildTrivaraNewOrderPayload(
      buildOrder({
        total_amount: 180,
        total: 180,
        subtotal: 200,
        discount_total: 20,
        items: [
          {
            ...buildOrder().items![0],
            unit_price: 200,
            total: 200,
          },
        ],
      }),
      newOrderConfig
    )

    expect(payload).toMatchObject({
      codAmount: 180,
      shippingCharges: 0,
      discount: 20,
      items: [
        {
          price: 200,
        },
      ],
    })
  })

  it("builds prepaid payload for online paid orders", () => {
    const payload = buildTrivaraNewOrderPayload(
      buildOrder({
        payment_method: "easebuzz",
        payment_status: "captured",
      }),
      newOrderConfig
    )

    expect(payload.paymentMode).toBe("PREPAID")
    expect(payload.codAmount).toBe(0)
  })

  it("builds COD payload for Easebuzz partial payment orders with pending balance", () => {
    const payload = buildTrivaraNewOrderPayload(
      buildOrder({
        payment_method: "pp_easebuzz_partial_payment",
        payment_status: "partially_paid",
        total_amount: 2500,
        metadata: {
          payment_type: "partial",
          advance_percentage: 20,
          advance_amount: 500,
          balance_amount: 2000,
          full_order_amount: 2500,
          balance_payment_status: "pending",
        },
      }),
      newOrderConfig
    )

    expect(payload.paymentMode).toBe("COD")
    expect(payload.codAmount).toBe(2000)
  })

  it("builds prepaid payload for Easebuzz partial payment orders after balance is paid", () => {
    const payload = buildTrivaraNewOrderPayload(
      buildOrder({
        payment_method: "pp_easebuzz_partial_payment",
        payment_status: "paid",
        total_amount: 2500,
        metadata: {
          payment_type: "partial",
          advance_percentage: 20,
          advance_amount: 500,
          balance_amount: 2000,
          full_order_amount: 2500,
          balance_payment_status: "paid",
          balance_paid_at: "2026-05-21T09:00:00.000Z",
          balance_payment_method: "Cash",
        },
      }),
      newOrderConfig
    )

    expect(payload.paymentMode).toBe("PREPAID")
    expect(payload.codAmount).toBe(0)
  })

  it("rejects missing required shipping fields", () => {
    const order = buildOrder({
      shipping_address: {
        ...buildOrder().shipping_address!,
        postal_code: null,
      },
    })

    expect(() => buildTrivaraNewOrderPayload(order, newOrderConfig)).toThrow(
      "Shipping pincode is required for Trivara New Order sync"
    )
  })

  it("reads new dashboard environment configuration", () => {
    process.env.TRIVARA_ORDER_SYNC_ENABLED = "true"
    process.env.TRIVARA_API_BASE_URL = "https://api-new.trivaralogistics.com"
    process.env.TRIVARA_API_KEY_ID = "key-id-1"
    process.env.TRIVARA_API_SECRET = "secret-1"
    process.env.TRIVARA_PICKUP_ADDRESS_ID = "pickup-123"
    process.env.TRIVARA_CHANNEL_NAME = "Toycker"

    expect(getTrivaraNewApiConfig()).toMatchObject({
      orderSyncEnabled: true,
      apiBaseUrl: "https://api-new.trivaralogistics.com",
      apiKeyId: "key-id-1",
      pickupAddressId: "pickup-123",
      channelName: "Toycker",
    })
  })

  it("requires new dashboard credentials when order sync is enabled", () => {
    process.env.TRIVARA_ORDER_SYNC_ENABLED = "true"
    process.env.TRIVARA_API_BASE_URL = "https://api-new.trivaralogistics.com"
    process.env.TRIVARA_API_KEY_ID = "key-id-1"
    process.env.TRIVARA_API_SECRET = ""

    expect(() => getTrivaraNewApiConfig()).toThrow(
      "Missing required environment variable: TRIVARA_API_SECRET"
    )
  })

  it("accepts only the configured Trivara webhook bearer token", () => {
    expect(
      verifyTrivaraWebhookAuthorization(
        "Bearer trivara_wh_12345678901234567890",
        "trivara_wh_12345678901234567890"
      )
    ).toEqual({ ok: true })

    expect(
      verifyTrivaraWebhookAuthorization(
        "Bearer wrong-token",
        "trivara_wh_12345678901234567890"
      )
    ).toMatchObject({ ok: false })
  })

  it("requires a strong Trivara webhook token in environment settings", () => {
    process.env.TRIVARA_WEBHOOK_AUTH_TOKEN = "short"

    expect(() => getTrivaraWebhookAuthToken()).toThrow(
      "TRIVARA_WEBHOOK_AUTH_TOKEN must be at least 20 characters long"
    )
  })

  it("rejects invalid Trivara base URLs before sending requests", () => {
    process.env.TRIVARA_API_BASE_URL = "OY6R-not-a-url"

    expect(() => getTrivaraNewApiConfig()).toThrow(
      "TRIVARA_API_BASE_URL must be a full URL starting with https:// or http://"
    )
  })

  it("gets a JWT with Key ID and Secret, then sends New Order JSON data", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init })

      if (String(input).endsWith("/merchant-api-keys/token")) {
        return new Response(JSON.stringify({ token: "access-token-1" }), {
          status: 200,
        })
      }

      return new Response(
        JSON.stringify({ orderId: "trivara-order-1", orderStatus: "New Order" }),
        { status: 201 }
      )
    })

    const result = await sendTrivaraNewOrder(
      buildTrivaraNewOrderPayload(buildOrder(), newOrderConfig),
      { ...authConfig, apiKeyId: "key-id-new-order" },
      fetcher
    )

    expect(requests[0]?.url).toBe(
      "https://api-new.trivaralogistics.com/merchant-api-keys/token"
    )
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      keyId: "key-id-new-order",
      secret: "secret-1",
    })
    expect(requests[1]?.url).toBe("https://api-new.trivaralogistics.com/orders")
    expect(requests[1]?.init?.headers).toMatchObject({
      Authorization: "Bearer access-token-1",
      "Content-Type": "application/json",
    })
    expect(JSON.parse(String(requests[1]?.init?.body))).toMatchObject({
      pickupAddressId: "pickup-123",
      externalOrderId: "toycker_order-1",
    })
    expect(result).toMatchObject({
      ok: true,
      status: 201,
      orderId: "trivara-order-1",
      orderStatus: "New Order",
      errorMessage: null,
    })
  })

  it("extracts visible Trivara order ID, internal API ID, and lifecycle status", () => {
    const payload = {
      status: "SUCCESS",
      data: {
        id: "cmr-internal-order-2",
        orderId: "TRV-000002",
        status: "PENDING",
      },
    }

    expect(extractTrivaraOrderId(payload)).toBe("TRV-000002")
    expect(extractTrivaraApiOrderId(payload)).toBe("cmr-internal-order-2")
    expect(extractTrivaraOrderStatus(payload)).toBe("PENDING")
  })

  it("extracts the real tracking webhook shape from data.order", () => {
    const payload = {
      status: "SUCCESS",
      data: {
        order: {
          awb: "14344968988391",
          orderId: "TRV-001254",
          status: "UNDELIVERED",
          courier: "XPRESSBEES",
          paymentMode: "Prepaid",
          timeline: [
            {
              id: "timeline-event-1",
              orderId: "internal-trivara-db-order-id",
              status: "OUT_FOR_DELIVERY",
            },
          ],
        },
      },
      message: "Tracking info loaded",
      extra: null,
    }

    expect(extractTrivaraOrderId(payload)).toBe("TRV-001254")
    expect(extractTrivaraOrderStatus(payload)).toBe("UNDELIVERED")
    expect(extractTrivaraApiOrderId(payload)).not.toBe("timeline-event-1")
    expect(extractTrivaraShipmentDetails(payload)).toMatchObject({
      awb: "14344968988391",
      courierName: "XPRESSBEES",
      shipmentStatus: "UNDELIVERED",
    })
  })

  it("does not extract real order data from Trivara test webhooks", () => {
    const payload = {
      event: null,
      merchantId: "toycker_india_fc1e44",
      timestamp: "2026-07-29T05:46:29.918Z",
      data: {
        _test: true,
        event: null,
        merchantId: "toycker_india_fc1e44",
      },
    }

    expect(extractTrivaraOrderId(payload)).toBeNull()
    expect(extractTrivaraOrderStatus(payload)).toBeNull()
    expect(extractTrivaraShipmentDetails(payload)).toEqual({
      awb: null,
      courierName: null,
      shipmentId: null,
      shipmentStatus: null,
      trackingUrl: null,
    })
  })
  it("treats Trivara business errors as failed New Order responses", async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      if (String(input).endsWith("/merchant-api-keys/token")) {
        return new Response(JSON.stringify({ token: "access-token-2" }), {
          status: 200,
        })
      }

      return new Response(
        JSON.stringify({ status: "failed", message: "Invalid pickup address" }),
        { status: 200 }
      )
    })

    const result = await sendTrivaraNewOrder(
      buildTrivaraNewOrderPayload(buildOrder(), newOrderConfig),
      { ...authConfig, apiKeyId: "key-id-error" },
      fetcher
    )

    expect(result.ok).toBe(false)
    expect(result.orderId).toBeNull()
    expect(result.errorMessage).toBe("Invalid pickup address")
  })

  it("detects unsuccessful response payloads", () => {
    expect(
      getTrivaraResponseBusinessError({ success: false, message: "Denied" })
    ).toBe("Denied")
  })

  it("includes low-level network cause details when fetch fails", async () => {
    const fetchError = Object.assign(new Error("fetch failed"), {
      cause: {
        code: "ENOTFOUND",
        hostname: "api-new.trivaralogistics.com",
        syscall: "getaddrinfo",
      },
    })
    const fetcher = vi.fn(async () => {
      throw fetchError
    })

    await expect(
      sendTrivaraNewOrder(
        buildTrivaraNewOrderPayload(buildOrder(), newOrderConfig),
        { ...authConfig, apiKeyId: "key-id-network" },
        fetcher
      )
    ).rejects.toThrow(
      "Trivara request failed before receiving a response (ENOTFOUND api-new.trivaralogistics.com getaddrinfo)"
    )
  })

  it("gets a JWT and fetches a Trivara order by internal API ID", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init })

      if (String(input).endsWith("/merchant-api-keys/token")) {
        return new Response(JSON.stringify({ token: "access-token-4" }), {
          status: 200,
        })
      }

      return new Response(
        JSON.stringify({
          status: "SUCCESS",
          data: {
            id: "cmr-internal-order-4",
            orderId: "TRV-000004",
            status: "CANCELLED",
          },
        }),
        { status: 200 }
      )
    })

    const result = await sendTrivaraGetOrder(
      "cmr-internal-order-4",
      { ...authConfig, apiKeyId: "key-id-get-order" },
      fetcher
    )

    expect(requests[1]?.url).toBe(
      "https://api-new.trivaralogistics.com/orders/cmr-internal-order-4"
    )
    expect(requests[1]?.init?.method).toBe("GET")
    expect(result.ok).toBe(true)
    expect(extractTrivaraOrderStatus(result.responsePayload)).toBe("CANCELLED")
  })
  it("gets a JWT and cancels a Trivara New Order by internal API ID", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init })

      if (String(input).endsWith("/merchant-api-keys/token")) {
        return new Response(JSON.stringify({ token: "access-token-3" }), {
          status: 200,
        })
      }

      return new Response(JSON.stringify({ status: "CANCELLED" }), {
        status: 200,
      })
    })

    const result = await sendTrivaraCancelNewOrder(
      "trivara-order-3",
      { ...authConfig, apiKeyId: "key-id-cancel" },
      fetcher
    )

    expect(requests[1]?.url).toBe(
      "https://api-new.trivaralogistics.com/orders/trivara-order-3/status"
    )
    expect(requests[1]?.init?.method).toBe("PATCH")
    expect(requests[1]?.init?.headers).toMatchObject({
      Authorization: "Bearer access-token-3",
      "Content-Type": "application/json",
    })
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      status: "CANCELLED",
    })
    expect(result.ok).toBe(true)
  })
  it("extracts AWB and courier details from nested shipment payloads", () => {
    const payload = {
      status: "SUCCESS",
      data: {
        shipment: {
          awbNumber: "AWB123456",
          courierName: "Delhivery",
          shipmentId: "shipment-1",
          shipmentStatus: "IN_TRANSIT",
          trackingUrl: "https://tracking.example/AWB123456",
        },
      },
    }

    expect(extractTrivaraShipmentDetails(payload)).toEqual({
      awb: "AWB123456",
      courierName: "Delhivery",
      shipmentId: "shipment-1",
      shipmentStatus: "IN_TRANSIT",
      trackingUrl: "https://tracking.example/AWB123456",
    })
  })

  it("extracts AWB details from alternate courier response keys", () => {
    const payload = {
      data: {
        waybill: "WB987654",
        carrier: "BlueDart",
        shipment_number: "SHP987",
        tracking_status: "PICKED_UP",
        public_url: "https://tracking.example/WB987654",
      },
    }

    expect(extractTrivaraShipmentDetails(payload)).toEqual({
      awb: "WB987654",
      courierName: "BlueDart",
      shipmentId: "SHP987",
      shipmentStatus: "PICKED_UP",
      trackingUrl: "https://tracking.example/WB987654",
    })
  })

  it("gets a JWT and fetches a Trivara shipment by shipment ID", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init })

      if (String(input).endsWith("/merchant-api-keys/token")) {
        return new Response(JSON.stringify({ token: "access-token-shipment" }), {
          status: 200,
        })
      }

      return new Response(
        JSON.stringify({
          status: "SUCCESS",
          data: {
            awbNumber: "AWB555",
            courierName: "Shree Maruti",
            shipmentStatus: "SHIPPED",
          },
        }),
        { status: 200 }
      )
    })

    const result = await sendTrivaraGetShipment(
      "shipment-555",
      { ...authConfig, apiKeyId: "key-id-get-shipment" },
      fetcher
    )

    expect(requests[1]?.url).toBe(
      "https://api-new.trivaralogistics.com/shipments/shipment-555"
    )
    expect(requests[1]?.init?.method).toBe("GET")
    expect(extractTrivaraShipmentDetails(result.responsePayload)).toMatchObject({
      awb: "AWB555",
      courierName: "Shree Maruti",
      shipmentStatus: "SHIPPED",
    })
  })
})
