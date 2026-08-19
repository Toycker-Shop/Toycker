import { NextRequest, NextResponse } from "next/server"
import {
  EasebuzzCallbackPayload,
  verifyEasebuzzHash,
  verifyEasebuzzMerchantKey,
} from "@/lib/easebuzz"
import { processEasebuzzPayment } from "@/lib/integrations/easebuzz-payment"

export const dynamic = "force-dynamic"

const RECENT_CALLBACKS = new Map<string, number>()
const THROTTLE_MS = 2000

function htmlRedirect(path: string): NextResponse {
  const responseHtml =
    "<!doctype html><html><head><title>Redirecting...</title><meta charset=\"utf-8\"></head>" +
    "<body><p>Processing payment response...</p>" +
    "<script>window.location.replace(" +
    JSON.stringify(path) +
    ")</script></body></html>"

  return new NextResponse(responseHtml, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}

const normalizeIp = (value: string | null): string =>
  value?.split(",")[0]?.trim() || "unknown"

function parseCallbackPayload(bodyText: string): EasebuzzCallbackPayload {
  const params = new URLSearchParams(bodyText)
  return Object.fromEntries(params.entries()) as EasebuzzCallbackPayload
}

function getCallbackErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : ""

  if (message.includes("cart not found")) return "cart_not_found"
  if (message.includes("checkout snapshot")) return "missing_checkout_snapshot"
  if (message.includes("order not found")) return "order_not_found"
  if (message.includes("amount mismatch")) return "amount_mismatch"
  if (message.includes("partial-payment data")) {
    return "partial_payment_data_missing"
  }

  return "callback_failed"
}

export async function POST(request: NextRequest) {
  const ip = normalizeIp(request.headers.get("x-forwarded-for"))
  const now = Date.now()
  const lastHit = RECENT_CALLBACKS.get(ip)

  if (lastHit && now - lastHit < THROTTLE_MS) {
    console.warn("[EASEBUZZ] Throttling possible duplicate callback for IP:", ip)
    return new NextResponse("Throttled", { status: 429 })
  }

  RECENT_CALLBACKS.set(ip, now)

  if (RECENT_CALLBACKS.size > 1000) {
    const cutoff = now - THROTTLE_MS
    RECENT_CALLBACKS.forEach((timestamp, key) => {
      if (timestamp < cutoff) {
        RECENT_CALLBACKS.delete(key)
      }
    })
  }

  let payload: EasebuzzCallbackPayload

  try {
    payload = parseCallbackPayload(await request.text())
  } catch (error) {
    console.error("[EASEBUZZ] Failed to parse callback:", error)
    return htmlRedirect("/checkout?step=payment&error=invalid_callback")
  }

  const merchantKey = process.env.EASEBUZZ_MERCHANT_KEY
  const merchantSalt = process.env.EASEBUZZ_MERCHANT_SALT

  if (!merchantKey || !merchantSalt) {
    console.error("[EASEBUZZ] Easebuzz credentials are not configured.")
    return htmlRedirect("/checkout?step=payment&error=configuration_error")
  }

  if (!verifyEasebuzzMerchantKey(payload, merchantKey)) {
    console.error("[EASEBUZZ] Merchant key verification failed:", payload.txnid)
    return htmlRedirect("/checkout?step=payment&error=invalid_key")
  }

  if (!verifyEasebuzzHash(payload, merchantSalt)) {
    console.error("[EASEBUZZ] Hash verification failed:", payload.txnid)
    return htmlRedirect("/checkout?step=payment&error=invalid_hash")
  }

  try {
    const result = await processEasebuzzPayment(payload)

    if (result.kind === "success") {
      const response = htmlRedirect(
        "/order/confirmed/" + result.orderId
      )
      response.cookies.delete("toycker_cart_id")
      return response
    }

    const reason =
      result.kind === "failure"
        ? result.reason
        : result.reason || "payment_pending"

    return htmlRedirect(
      "/checkout?step=payment&error=" +
        encodeURIComponent(reason) +
        "&status=" +
        encodeURIComponent(payload.status || "")
    )
  } catch (error) {
    console.error("[EASEBUZZ] Callback processing failed:", error)
    return htmlRedirect(
      "/checkout?error=" + getCallbackErrorCode(error)
    )
  }
}

export async function GET() {
  return new NextResponse("Easebuzz Callback Endpoint Active", { status: 200 })
}
