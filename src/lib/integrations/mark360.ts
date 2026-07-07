"use server"

type SendMark360OtpParams = {
  destination: string
  otpCode: string
}

type SendMark360OtpResult = {
  providerMessageId?: string
}

type Mark360SendMessagesPayload = {
  mobile: string
  template_name: string
  data: {
    otp: string
  }
}

const DEFAULT_MARK360_API_BASE_URL = "https://app.mark360.ai/api/v1"
const DEFAULT_MARK360_SEND_MESSAGES_PATH = "/send-messages"
const DEFAULT_MARK360_REQUEST_TIMEOUT_MS = 10000

function getTrimmedEnv(key: string): string | null {
  const value = process.env[key]?.trim()
  return value || null
}

function getRequiredEnv(key: string): string {
  const value = getTrimmedEnv(key)

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }

  return value
}

function getNumericEnv(key: string, fallbackValue: number): number {
  const rawValue = getTrimmedEnv(key)

  if (!rawValue) {
    return fallbackValue
  }

  const parsedValue = Number.parseInt(rawValue, 10)

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallbackValue
  }

  return parsedValue
}

function buildEndpointUrl(): string {
  const baseUrl = (
    getTrimmedEnv("MARK360_API_BASE_URL") || DEFAULT_MARK360_API_BASE_URL
  ).replace(/\/+$/, "")
  const path =
    getTrimmedEnv("MARK360_SEND_MESSAGES_PATH") ||
    DEFAULT_MARK360_SEND_MESSAGES_PATH

  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`
}

function normalizeRecipientMobile(destination: string): string {
  return destination.replace(/\D/g, "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function extractProviderMessageId(value: unknown): string | undefined {
  const queue: unknown[] = [value]
  const idKeys = new Set([
    "id",
    "messageId",
    "message_id",
    "messageUuid",
    "message_uuid",
    "providerMessageId",
    "provider_message_id",
    "wamid",
  ])

  while (queue.length > 0) {
    const current = queue.shift()

    if (Array.isArray(current)) {
      queue.push(...current)
      continue
    }

    if (!isRecord(current)) {
      continue
    }

    for (const [key, nestedValue] of Object.entries(current)) {
      if (idKeys.has(key) && typeof nestedValue === "string") {
        return nestedValue
      }

      if (isRecord(nestedValue) || Array.isArray(nestedValue)) {
        queue.push(nestedValue)
      }
    }
  }

  return undefined
}

function extractErrorMessage(value: unknown): string | undefined {
  const queue: unknown[] = [value]
  const messageKeys = new Set(["message", "error", "detail", "description"])

  while (queue.length > 0) {
    const current = queue.shift()

    if (Array.isArray(current)) {
      queue.push(...current)
      continue
    }

    if (!isRecord(current)) {
      continue
    }

    for (const [key, nestedValue] of Object.entries(current)) {
      if (messageKeys.has(key) && typeof nestedValue === "string") {
        return nestedValue
      }

      if (isRecord(nestedValue) || Array.isArray(nestedValue)) {
        queue.push(nestedValue)
      }
    }
  }

  return undefined
}

function isFailureResponse(value: unknown): boolean {
  const queue: unknown[] = [value]

  while (queue.length > 0) {
    const current = queue.shift()

    if (Array.isArray(current)) {
      queue.push(...current)
      continue
    }

    if (!isRecord(current)) {
      continue
    }

    for (const [key, nestedValue] of Object.entries(current)) {
      const normalizedKey = key.toLowerCase()

      if (
        normalizedKey === "status" &&
        typeof nestedValue === "string" &&
        ["error", "fail", "failed", "failure"].includes(
          nestedValue.trim().toLowerCase()
        )
      ) {
        return true
      }

      if (
        normalizedKey === "code" &&
        typeof nestedValue === "number" &&
        nestedValue >= 400
      ) {
        return true
      }

      if (
        normalizedKey === "error" &&
        typeof nestedValue === "string" &&
        nestedValue.trim()
      ) {
        return true
      }

      if (normalizedKey === "errors" && isRecord(nestedValue)) {
        return true
      }

      if (isRecord(nestedValue) || Array.isArray(nestedValue)) {
        queue.push(nestedValue)
      }
    }
  }

  return false
}

async function parseMark360Response(response: Response): Promise<unknown> {
  const responseText = await response.text()

  if (!responseText) {
    return null
  }

  try {
    return JSON.parse(responseText) as unknown
  } catch {
    return responseText
  }
}

export async function sendMark360Otp({
  destination,
  otpCode,
}: SendMark360OtpParams): Promise<SendMark360OtpResult> {
  const accessToken = getRequiredEnv("MARK360_ACCESS_TOKEN")
  const templateName = getRequiredEnv("MARK360_AUTH_TEMPLATE_NAME")
  const timeoutMs = getNumericEnv(
    "MARK360_REQUEST_TIMEOUT_MS",
    DEFAULT_MARK360_REQUEST_TIMEOUT_MS
  )

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  const payload: Mark360SendMessagesPayload = {
    mobile: normalizeRecipientMobile(destination),
    template_name: templateName,
    data: {
      otp: otpCode,
    },
  }

  try {
    const response = await fetch(buildEndpointUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    })

    const responseBody = await parseMark360Response(response)

    if (!response.ok) {
      const detail = extractErrorMessage(responseBody)
      throw new Error(
        `Mark360 request failed with status ${response.status}${
          detail ? `: ${detail}` : ""
        }`
      )
    }

    if (isFailureResponse(responseBody)) {
      const detail = extractErrorMessage(responseBody)
      throw new Error(`Mark360 request failed${detail ? `: ${detail}` : ""}`)
    }

    return {
      providerMessageId: extractProviderMessageId(responseBody),
    }
  } finally {
    clearTimeout(timeout)
  }
}


