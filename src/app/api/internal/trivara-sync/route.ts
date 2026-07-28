import { timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { syncRecentTrivaraBookings } from "@/lib/data/trivara-logistics"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getCronSecret(): string {
  const secret = process.env.CRON_SECRET?.trim() || ""

  if (!secret) {
    throw new Error("Missing required environment variable: CRON_SECRET")
  }

  if (secret.length < 16) {
    throw new Error("CRON_SECRET must be at least 16 characters long")
  }

  return secret
}

function safeTokenEquals(receivedToken: string, expectedToken: string): boolean {
  const received = Buffer.from(receivedToken)
  const expected = Buffer.from(expectedToken)

  if (received.length !== expected.length) {
    return false
  }

  return timingSafeEqual(received, expected)
}

function verifyCronAuthorization(
  authorizationHeader: string | null,
  expectedToken: string
): boolean {
  const prefix = "Bearer "

  if (!authorizationHeader?.startsWith(prefix)) {
    return false
  }

  return safeTokenEquals(authorizationHeader.slice(prefix.length).trim(), expectedToken)
}

function getLimit(request: NextRequest): number {
  const rawLimit = request.nextUrl.searchParams.get("limit")
  const parsedLimit = rawLimit ? Number(rawLimit) : 10

  if (!Number.isFinite(parsedLimit)) {
    return 10
  }

  return Math.min(Math.max(Math.trunc(parsedLimit), 1), 25)
}

export async function GET(request: NextRequest) {
  let expectedToken: string

  try {
    expectedToken = getCronSecret()
  } catch (error) {
    console.error("[TRIVARA_SYNC] Missing sync configuration", error)
    return NextResponse.json(
      { success: false, error: "Trivara fallback sync is not configured." },
      { status: 500 }
    )
  }

  if (!verifyCronAuthorization(request.headers.get("authorization"), expectedToken)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized fallback sync request." },
      { status: 401 }
    )
  }

  try {
    const results = await syncRecentTrivaraBookings(getLimit(request))
    const synced = results.filter((result) => result.ok).length
    const failed = results.length - synced

    return NextResponse.json({
      success: true,
      checked: results.length,
      synced,
      failed,
      results,
    })
  } catch (error) {
    console.error("[TRIVARA_SYNC] Fallback sync failed", error)
    return NextResponse.json(
      { success: false, error: "Trivara fallback sync failed." },
      { status: 500 }
    )
  }
}
