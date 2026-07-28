"use client"

import { useEffect, useMemo, useRef } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@lib/supabase/client"

type RealtimeLogisticsListenerProps = {
  orderId?: string
}

export default function RealtimeLogisticsListener({
  orderId,
}: RealtimeLogisticsListenerProps) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
      }

      refreshTimerRef.current = setTimeout(() => {
        router.refresh()
        refreshTimerRef.current = null
      }, 500)
    }

    const bookingFilter = orderId ? `order_id=eq.${orderId}` : undefined
    const orderFilter = orderId ? `id=eq.${orderId}` : undefined
    const channel = supabase
      .channel(orderId ? `admin-logistics-${orderId}` : "admin-logistics-list")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "trivara_order_bookings",
          ...(bookingFilter ? { filter: bookingFilter } : {}),
        },
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "trivara_order_bookings",
          ...(bookingFilter ? { filter: bookingFilter } : {}),
        },
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          ...(orderFilter ? { filter: orderFilter } : {}),
        },
        scheduleRefresh
      )
      .subscribe()

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
      supabase.removeChannel(channel)
    }
  }, [orderId, router, supabase])

  return null
}
