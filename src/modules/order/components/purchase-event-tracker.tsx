"use client"

import { useEffect, useRef } from "react"

import { Order } from "@/lib/supabase/types"
import { MarketingItem, trackPurchaseEvent } from "@/lib/analytics/client-events"

export default function PurchaseEventTracker({ order, enabled }: { order: Order; enabled: boolean }) {
  const trackedOrderId = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || trackedOrderId.current === order.id) return
    const items: MarketingItem[] = (order.items ?? [])
      .filter((item) => item.metadata?.gift_wrap_line !== true)
      .map((item) => ({
        item_id: item.variant?.sku || item.variant_id || item.product_id,
        item_name: item.product_title || item.title,
        item_variant: item.variant?.title,
        price: item.unit_price,
        quantity: item.quantity,
      }))

    if (items.length === 0) return
    trackedOrderId.current = order.id
    trackPurchaseEvent(order.id, items, order.total_amount, order.currency_code.toUpperCase())
  }, [enabled, order])

  return null
}
