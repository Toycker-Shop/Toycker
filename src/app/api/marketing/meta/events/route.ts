import { isIP } from "node:net"

import { NextResponse } from "next/server"
import { cookies, headers } from "next/headers"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { buildMetaUserData, sendMetaEvent } from "@/lib/integrations/meta-capi"
import { getBaseURL } from "@/lib/util/env"

const MetaContentSchema = z.object({
  id: z.string().trim().min(1).max(200),
  quantity: z.number().finite().positive().max(1000),
  item_price: z.number().finite().nonnegative(),
})

const MetaEventRequestSchema = z.object({
  event_name: z.enum([
    "ViewContent",
    "AddToCart",
    "InitiateCheckout",
    "Search",
    "AddPaymentInfo",
  ]),
  event_id: z.string().trim().min(1).max(200),
  event_source_url: z.string().url().max(2048),
  custom_data: z.object({
    currency: z.string().trim().min(3).max(3).optional(),
    value: z.number().finite().nonnegative().optional(),
    contents: z.array(MetaContentSchema).max(100).optional(),
    content_ids: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
    content_type: z.enum(["product", "product_group"]).optional(),
    num_items: z.number().finite().nonnegative().optional(),
    search_string: z.string().trim().min(1).max(100).optional(),
  }).strict(),
})

const getString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined

const getClientIp = (requestHeaders: Headers): string | undefined => {
  const forwardedIp = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim()
  const directIp = requestHeaders.get("x-real-ip")?.trim()
  const candidate = forwardedIp || directIp
  return candidate && isIP(candidate) ? candidate : undefined
}

const isSameOrigin = (sourceUrl: string): boolean => {
  try {
    return new URL(sourceUrl).origin === new URL(getBaseURL()).origin
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json()
    const parsed = MetaEventRequestSchema.safeParse(body)

    if (!parsed.success || !isSameOrigin(parsed.data.event_source_url)) {
      return NextResponse.json({ accepted: false }, { status: 400 })
    }

    const requestCookies = await cookies()
    const requestHeaders = await headers()
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const metadata = user?.user_metadata
    const userMetadata = typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
      ? metadata as Record<string, unknown>
      : {}

    const event = {
      event_name: parsed.data.event_name,
      event_time: Math.floor(Date.now() / 1000),
      event_id: parsed.data.event_id,
      event_source_url: parsed.data.event_source_url,
      action_source: "website" as const,
      user_data: buildMetaUserData({
        email: user?.email,
        phone: user?.phone ?? getString(userMetadata.phone),
        externalId: user?.id,
        firstName: getString(userMetadata.first_name) ?? getString(userMetadata.firstName),
        lastName: getString(userMetadata.last_name) ?? getString(userMetadata.lastName),
        fbp: requestCookies.get("_fbp")?.value,
        fbc: requestCookies.get("_fbc")?.value,
        clientIpAddress: getClientIp(requestHeaders),
        clientUserAgent: requestHeaders.get("user-agent"),
      }),
      custom_data: parsed.data.custom_data,
    }

    await sendMetaEvent(event)
    return NextResponse.json({ accepted: true })
  } catch (error) {
    console.warn("Meta browser event delivery failed:", error)
    return NextResponse.json({ accepted: false }, { status: 202 })
  }
}
