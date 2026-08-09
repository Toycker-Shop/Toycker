"use client"

import { useEffect, useRef } from "react"

import { Product, ProductVariant } from "@/lib/supabase/types"
import { trackProductEvent } from "@/lib/analytics/client-events"

type ProductViewTrackerProps = {
  product: Product
  variant?: ProductVariant
}

export default function ProductViewTracker({ product, variant }: ProductViewTrackerProps) {
  const trackedProductKey = useRef<string | null>(null)
  const productKey = `${product.id}:${variant?.sku || variant?.id || "default"}`
  const itemId = variant?.sku || variant?.id || product.id
  const price = variant?.price ?? product.price
  const currency = product.currency_code.toUpperCase()

  useEffect(() => {
    if (trackedProductKey.current === productKey) return
    trackedProductKey.current = productKey

    trackProductEvent(
      "view_item",
      {
        item_id: itemId,
        meta_content_id: product.id,
        item_name: product.name,
        item_variant: variant?.title,
        price,
        quantity: 1,
      },
      price,
      currency,
    )
  }, [currency, itemId, price, product.id, product.name, productKey, variant?.title])

  return null
}
