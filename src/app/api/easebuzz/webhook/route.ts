import { NextRequest, NextResponse } from "next/server"
import {
  EasebuzzCallbackPayload,
  verifyEasebuzzHash,
  verifyEasebuzzMerchantKey,
} from "@/lib/easebuzz"
import { processEasebuzzPayment } from "@/lib/integrations/easebuzz-payment"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type StringRecord = Record<string, string>

function isStringRecord(value: unknown): value is StringRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false
  }

  return Object.values(value).every((item) => typeof item === "string")
}

async function readWebhookPayload(
  request: NextRequest
): Promise<EasebuzzCallbackPayload> {
  const contentType = request.headers.get("content-type")?.toLowerCase() || ""

  if (contentType.includes("application/json")) {
    const body: unknown = await request.json()

    if (!isStringRecord(body)) {
      throw new Error("Easebuzz webhook JSON body must contain string values")
    }

    return body as EasebuzzCallbackPayload
  }

  const bodyText = await request.text()
  const form = new URLSearchParams(bodyText)
  const payload: StringRecord = Object.fromEntries(form.entries())

  return payload as EasebuzzCallbackPayload
}

function isCompletePaymentPayload(
  payload: EasebuzzCallbackPayload
): boolean {
  return Boolean(
    payload.status &&
      payload.txnid &&
      payload.amount &&
      payload.key &&
      payload.hash
  )
}

export async function POST(request: NextRequest) {
  let payload: EasebuzzCallbackPayload

  try {
    payload = await readWebhookPayload(request)
  } catch (error) {
    console.error("[EASEBUZZ_WEBHOOK] Invalid request body:", error)

    return NextResponse.json(
      { success: false, error: "Invalid Easebuzz webhook body." },
      { status: 400 }
    )
  }

  if (!isCompletePaymentPayload(payload)) {
    return NextResponse.json(
      { success: false, error: "Incomplete Easebuzz webhook payload." },
      { status: 400 }
    )
  }

  const merchantKey = process.env.EASEBUZZ_MERCHANT_KEY
  const merchantSalt = process.env.EASEBUZZ_MERCHANT_SALT

  if (!merchantKey || !merchantSalt) {
    console.error("[EASEBUZZ_WEBHOOK] Easebuzz credentials are not configured.")

    return NextResponse.json(
      { success: false, error: "Easebuzz webhook is not configured." },
      { status: 500 }
    )
  }

  if (!verifyEasebuzzMerchantKey(payload, merchantKey)) {
    console.warn(
      "[EASEBUZZ_WEBHOOK] Merchant key verification failed:",
      payload.txnid
    )

    return NextResponse.json(
      { success: false, error: "Invalid Easebuzz merchant key." },
      { status: 401 }
    )
  }

  if (!verifyEasebuzzHash(payload, merchantSalt)) {
    console.warn(
      "[EASEBUZZ_WEBHOOK] Hash verification failed:",
      payload.txnid
    )

    return NextResponse.json(
      { success: false, error: "Invalid Easebuzz webhook hash." },
      { status: 401 }
    )
  }

  try {
    const result = await processEasebuzzPayment(payload)

    return NextResponse.json({
      success: true,
      result: result.kind,
      orderId: result.orderId,
      status: payload.status,
      alreadyProcessed:
        result.kind === "success" ? result.alreadyProcessed : undefined,
    })
  } catch (error) {
    console.error(
      "[EASEBUZZ_WEBHOOK] Payment processing failed:",
      payload.txnid,
      error
    )

    return NextResponse.json(
      { success: false, error: "Easebuzz payment processing failed." },
      { status: 500 }
    )
  }
}

export async function GET() {
  return new NextResponse("Easebuzz Webhook Endpoint Active", { status: 200 })
}
