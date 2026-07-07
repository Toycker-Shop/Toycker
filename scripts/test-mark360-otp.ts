import { config } from "dotenv"

config()

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

type PayloadVariant = "array" | "object" | "otp" | "popup"
type TemplatePayload = { [key: string]: JsonValue }

type CliOptions = {
  mobile: string
  code: string
  variant: PayloadVariant
}

type RequestResult = {
  status: number
  ok: boolean
  body: unknown
  durationMs: number
}

const DEFAULT_MARK360_API_BASE_URL = "https://app.mark360.ai/api/v1"
const DEFAULT_MARK360_SEND_MESSAGES_PATH = "/send-messages"
const DEFAULT_TEST_CODE = "1234"

function getOptionValue(name: string): string | null {
  const prefix = `--${name}=`
  const value = process.argv.find((arg) => arg.startsWith(prefix))
  return value ? value.slice(prefix.length).trim() : null
}

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

function normalizeMobile(value: string): string {
  return value.replace(/\D/g, "")
}

function getEndpointUrl(path: string): string {
  const baseUrl = (
    getTrimmedEnv("MARK360_API_BASE_URL") || DEFAULT_MARK360_API_BASE_URL
  ).replace(/\/+$/, "")
  const normalizedPath = path.startsWith("/") ? path : `/${path}`

  return `${baseUrl}${normalizedPath}`
}

function parseVariant(value: string | null): PayloadVariant {
  if (value === "object" || value === "otp" || value === "popup") {
    return value
  }

  return "array"
}

function getCliOptions(): CliOptions {
  const mobile = normalizeMobile(getOptionValue("mobile") || "")

  if (!mobile) {
    throw new Error(
      "Usage: pnpm.cmd exec tsx scripts/test-mark360-otp.ts --mobile=91XXXXXXXXXX [--code=1234] [--variant=array|object|otp|popup]"
    )
  }

  return {
    mobile,
    code: getOptionValue("code") || DEFAULT_TEST_CODE,
    variant: parseVariant(getOptionValue("variant")),
  }
}

function maskMobile(mobile: string): string {
  if (mobile.length <= 4) {
    return "****"
  }

  return `${mobile.slice(0, 4)}****${mobile.slice(-2)}`
}

function redactSensitiveValue(key: string, value: unknown): JsonValue {
  const lowerKey = key.toLowerCase()

  if (
    lowerKey.includes("token") ||
    lowerKey.includes("secret") ||
    lowerKey.includes("password") ||
    lowerKey.includes("authorization")
  ) {
    return "[redacted]"
  }

  if (typeof value === "string") {
    return value
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJson(item))
  }

  if (value && typeof value === "object") {
    return sanitizeJson(value)
  }

  return String(value)
}

function sanitizeJson(value: unknown): JsonValue {
  if (typeof value === "string") {
    return value
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJson(item))
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        redactSensitiveValue(key, nestedValue),
      ])
    ) as { [key: string]: JsonValue }
  }

  return String(value)
}

function formatJson(value: unknown): string {
  return JSON.stringify(sanitizeJson(value), null, 2)
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text()

  if (!text) {
    return null
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

async function postJson(path: string, body?: JsonValue): Promise<RequestResult> {
  const accessToken = getRequiredEnv("MARK360_ACCESS_TOKEN")
  const startedAt = Date.now()

  const response = await fetch(getEndpointUrl(path), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  return {
    status: response.status,
    ok: response.ok,
    body: await parseResponseBody(response),
    durationMs: Date.now() - startedAt,
  }
}

function buildTemplatePayload({
  mobile,
  code,
  variant,
}: CliOptions): TemplatePayload {
  const templateName = getRequiredEnv("MARK360_AUTH_TEMPLATE_NAME")

  if (variant === "popup") {
    return {
      mobile,
      template_name: templateName,
      organization_id: getTrimmedEnv("MARK360_ORGANIZATION_ID") || "",
      data: {
        header_values: [],
        header_media_values: {},
        body_values: [
          {
            "1": code,
          },
        ],
        button_values: [],
        carousel_card_values: [],
        card_button_values: [],
        card_body_values: [],
      },
    }
  }

  if (variant === "otp") {
    return {
      mobile,
      template_name: templateName,
      data: {
        otp: code,
      },
    }
  }

  if (variant === "object") {
    return {
      mobile,
      template_name: templateName,
      organization_id: getTrimmedEnv("MARK360_ORGANIZATION_ID") || "",
      data: {
        header_values: [],
        header_media_values: {},
        body_values: [code],
        button_values: [code],
        carousel_card_values: [],
        card_button_values: [],
        card_body_values: [],
      },
    }
  }

  return {
    mobile,
    template_name: templateName,
    data: [code],
  }
}

async function run(): Promise<void> {
  const options = getCliOptions()
  const sendMessagesPath =
    getTrimmedEnv("MARK360_SEND_MESSAGES_PATH") || DEFAULT_MARK360_SEND_MESSAGES_PATH

  console.log("Mark360 OTP diagnostic")
  console.log(
    formatJson({
      apiBaseUrl: getTrimmedEnv("MARK360_API_BASE_URL") || DEFAULT_MARK360_API_BASE_URL,
      sendMessagesPath,
      mobile: maskMobile(options.mobile),
      templateName: getRequiredEnv("MARK360_AUTH_TEMPLATE_NAME"),
      variant: options.variant,
      codeLength: options.code.length,
      hasAccessToken: Boolean(getTrimmedEnv("MARK360_ACCESS_TOKEN")),
      hasOrganizationId: Boolean(getTrimmedEnv("MARK360_ORGANIZATION_ID")),
    })
  )

  console.log("\nChecking token with /me ...")
  const meResult = await postJson("/me")
  console.log(
    formatJson({
      status: meResult.status,
      ok: meResult.ok,
      durationMs: meResult.durationMs,
      body: meResult.body,
    })
  )

  console.log("\nSending template message ...")
  const payload = buildTemplatePayload(options)
  console.log("Sanitized payload:")
  console.log(formatJson({ ...payload, mobile: maskMobile(options.mobile) }))

  const sendResult = await postJson(sendMessagesPath, payload)
  console.log("Mark360 response:")
  console.log(
    formatJson({
      status: sendResult.status,
      ok: sendResult.ok,
      durationMs: sendResult.durationMs,
      body: sendResult.body,
    })
  )
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})


