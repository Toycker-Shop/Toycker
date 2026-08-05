"use client"

import { useEffect } from "react"

import { Product, ProductVariant } from "@/lib/supabase/types"
import { trackProductEvent } from "@/lib/analytics/client-events"

type ProductViewTrackerProps = {
  product: Product
  variant?: ProductVariant
}

export default function ProductViewTracker({ product, variant }: ProductViewTrackerProps) {
  useEffect(() => {
    trackProductEvent(
      "view_item",
      {
        item_id: variant?.sku || variant?.id || product.id,
        item_name: product.name,
        item_variant: variant?.title,
        price: variant?.price ?? product.price,
        quantity: 1,
      },
      variant?.price ?? product.price,
      product.currency_code.toUpperCase()
    )
  }, [product, variant])

  return null
}
