import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getImageUrl } from "@/lib/util/get-image-url"
import { getBaseURL } from "@/lib/util/env"

export const revalidate = 900

type MerchantProductRow = {
  id: string
  handle: string
  name: string
  description: string | null
  short_description: string | null
  price: number
  currency_code: string
  image_url: string | null
  thumbnail: string | null
  stock_count: number
  status: string
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")

const plainText = (value: string): string =>
  value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()

export async function GET() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, handle, name, description, short_description, price, currency_code, image_url, thumbnail, stock_count, status"
    )
    .eq("status", "active")

  if (error) {
    return new NextResponse("Unable to generate product feed", { status: 500 })
  }

  const baseUrl = getBaseURL()
  const products = (data ?? []) as MerchantProductRow[]
  const items = products
    .map((product) => {
      const imageUrl = getImageUrl(product.image_url || product.thumbnail)
      const description = plainText(
        product.description || product.short_description || product.name,
      )
      const currency = product.currency_code.trim().toUpperCase()
      const price = Number(product.price)

      if (!imageUrl || !currency || !Number.isFinite(price) || price < 0) {
        return null
      }

      return `
    <item>
      <g:id>${escapeXml(product.id)}</g:id>
      <g:title>${escapeXml(product.name)}</g:title>
      <g:description>${escapeXml(description)}</g:description>
      <g:link>${escapeXml(`${baseUrl}/products/${product.handle}`)}</g:link>
      <g:image_link>${escapeXml(imageUrl)}</g:image_link>
      <g:availability>${product.stock_count > 0 ? "in_stock" : "out_of_stock"}</g:availability>
      <g:price>${price.toFixed(2)} ${escapeXml(currency)}</g:price>
      <g:condition>new</g:condition>
      <g:brand>Toycker</g:brand>
      <g:identifier_exists>false</g:identifier_exists>
    </item>`
    })
    .filter((item): item is string => item !== null)
    .join("")

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Toycker product feed</title>
    <link>${escapeXml(baseUrl)}</link>
    <description>Active Toycker products</description>${items}
  </channel>
</rss>`

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=900, s-maxage=900",
    },
  })
}
