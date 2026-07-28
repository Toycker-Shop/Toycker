import { NextRequest, NextResponse } from "next/server"
import { processTrivaraWebhookPayload } from "@/lib/data/trivara-logistics"
import {
  getTrivaraWebhookAuthToken,
  verifyTrivaraWebhookAuthorization,
} from "@/lib/integrations/trivara-webhook"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export async function POST(request: NextRequest) {
  let expectedToken: string

  try {
    expectedToken = getTrivaraWebhookAuthToken()
  } catch (error) {
    console.error("[TRIVARA_WEBHOOK] Missing webhook configuration", error)
    return NextResponse.json(
      { success: false, error: "Trivara webhook is not configured." },
      { status: 500 }
    )
  }

  const authorization = verifyTrivaraWebhookAuthorization(
    request.headers.get("authorization"),
    expectedToken
  )

  if (!authorization.ok) {
    return NextResponse.json(
      { success: false, error: "Unauthorized Trivara webhook request." },
      { status: 401 }
    )
  }

  let payload: unknown

  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON payload." },
      { status: 400 }
    )
  }

  if (!isRecord(payload)) {
    return NextResponse.json(
      { success: false, error: "Webhook payload must be a JSON object." },
      { status: 400 }
    )
  }

  try {
    const result = await processTrivaraWebhookPayload(payload)

    if (!result.matched) {
      return NextResponse.json({
        success: true,
        matched: false,
        eventId: result.eventId,
        message: result.message,
      })
    }

    return NextResponse.json({
      success: true,
      matched: true,
      eventId: result.eventId,
      orderId: result.orderId,
      message: result.message,
    })
  } catch (error) {
    console.error("[TRIVARA_WEBHOOK] Failed to process webhook", error)
    return NextResponse.json(
      { success: false, error: "Trivara webhook processing failed." },
      { status: 500 }
    )
  }
}
