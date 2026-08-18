'use client'

import { useEffect, useMemo } from 'react'
import { createClient } from '@lib/supabase/client'

export type RealtimeOrderChangeType = 'INSERT' | 'UPDATE' | 'DELETE'

export type RealtimeOrderChange = {
  type: RealtimeOrderChangeType
  orderId: string
}

interface RealtimeOrdersListenerProps {
  onOrderChange: (_change: RealtimeOrderChange) => void
}

export default function RealtimeOrdersListener({
  onOrderChange,
}: RealtimeOrdersListenerProps) {
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    const channel = supabase
      .channel('admin-orders-list')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
        },
        (payload) => {
          const record = payload.eventType === 'DELETE' ? payload.old : payload.new
          const orderId = record && typeof record.id === 'string' ? record.id : null

          if (!orderId) {
            return
          }

          onOrderChange({
            type: payload.eventType as RealtimeOrderChangeType,
            orderId,
          })
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [onOrderChange, supabase])

  return null
}
