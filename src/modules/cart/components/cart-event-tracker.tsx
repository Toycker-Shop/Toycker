"use client"

import { useEffect, useRef } from "react"

import { Cart } from "@/lib/supabase/types"
import { MarketingItem, trackCartEvent } from "@/lib/analytics/client-events"

const buildItems = (cart: Cart): MarketingItem[] =>
  (cart.items ?? [])
    .filter((item) => item.metadata?.gift_wrap_line !== true)
    .map((item) => ({
      item_id: item.variant?.sku || item.variant_id || item.product_id,
      meta_content_id: item.product_id,
      item_name: item.product_title || item.title,
      item_variant: item.variant?.title,
      price: item.unit_price,
      quantity: item.quantity,
    }))

export default function CartEventTracker({ cart }: { cart: Cart }) {
  const trackedCartId = useRef<string | null>(null)

  useEffect(() => {
    if (trackedCartId.current === cart.id) return
    const items = buildItems(cart)
    if (items.length === 0) return

    trackedCartId.current = cart.id
    trackCartEvent("view_cart", items, cart.total ?? cart.subtotal ?? 0, cart.currency_code.toUpperCase())
  }, [cart])

  return null
}
