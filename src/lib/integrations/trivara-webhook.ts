import "server-only"

import { timingSafeEqual } from "crypto"

export type TrivaraWebhookAuthorizationResult =
  | { ok: true }
  | { ok: false; error: string }

function getTrimmedEnv(key: string): string {
  return process.env[key]?.trim() || ""
}

export function getTrivaraWebhookAuthToken(): string {
  const token = getTrimmedEnv("TRIVARA_WEBHOOK_AUTH_TOKEN")

  if (!token) {
    throw new Error("Missing required environment variable: TRIVARA_WEBHOOK_AUTH_TOKEN")
  }

  if (token.length < 20) {
    throw new Error("TRIVARA_WEBHOOK_AUTH_TOKEN must be at least 20 characters long")
  }

  return token
}

function safeTokenEquals(receivedToken: string, expectedToken: string): boolean {
  const received = Buffer.from(receivedToken)
  const expected = Buffer.from(expectedToken)

  if (received.length !== expected.length) {
    return false
  }

  return timingSafeEqual(received, expected)
}

export function verifyTrivaraWebhookAuthorization(
  authorizationHeader: string | null,
  expectedToken: string
): TrivaraWebhookAuthorizationResult {
  const prefix = "Bearer "

  if (!authorizationHeader?.startsWith(prefix)) {
    return {
      ok: false,
      error: "Missing or invalid Trivara webhook authorization header.",
    }
  }

  const receivedToken = authorizationHeader.slice(prefix.length).trim()

  if (!receivedToken || !safeTokenEquals(receivedToken, expectedToken)) {
    return {
      ok: false,
      error: "Invalid Trivara webhook token.",
    }
  }

  return { ok: true }
}
