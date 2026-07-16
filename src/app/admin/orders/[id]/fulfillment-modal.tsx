"use client"

import { useState } from "react"
import { useFormStatus } from "react-dom"
import { fulfillOrder } from "@/lib/data/admin"
import { ShippingPartner } from "@/lib/supabase/types"
import { XMarkIcon, TruckIcon } from "@heroicons/react/24/outline"

interface FulfillmentModalProps {
  orderId: string
  trivaraPartner: ShippingPartner | null
  initialAwb?: string | null
}

function FulfillButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="flex min-w-[140px] items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? (
        <>
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          <span>Fulfilling...</span>
        </>
      ) : (
        "Fulfill Order"
      )}
    </button>
  )
}

export default function FulfillmentModal({
  orderId,
  trivaraPartner,
  initialAwb,
}: FulfillmentModalProps) {
  const [isOpen, setIsOpen] = useState(false)
  const canFulfill = Boolean(trivaraPartner)

  const handleSubmit = async (formData: FormData) => {
    try {
      await fulfillOrder(orderId, formData)
      setIsOpen(false)
    } catch (error) {
      console.error("Error fulfilling order:", error)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition-all hover:bg-indigo-700"
      >
        Fulfill Items
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
          />

          <div className="relative mx-4 w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50">
                  <TruckIcon className="h-5 w-5 text-indigo-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">
                    Fulfill Order
                  </h2>
                  <p className="text-xs text-gray-500">
                    Use Trivara Logistics and enter the AWB generated
                    after shipment creation in Trivara.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-2 transition-colors hover:bg-gray-100"
              >
                <XMarkIcon className="h-5 w-5 text-gray-400" />
              </button>
            </div>

            <form action={handleSubmit} className="space-y-5 p-6">
              <div>
                <label
                  htmlFor="shipping_partner_id"
                  className="mb-2 block text-sm font-bold text-gray-700"
                >
                  Shipping Partner *
                </label>
                <input
                  type="hidden"
                  name="shipping_partner_id"
                  value={trivaraPartner?.id || ""}
                />
                <div
                  id="shipping_partner_id"
                  className="block w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-900"
                >
                  {trivaraPartner?.name || "Trivara Logistics not active"}
                </div>
                {!trivaraPartner && (
                  <p className="mt-2 text-xs text-amber-600">
                    Trivara Logistics must be active before fulfilling orders.
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="tracking_number"
                  className="mb-2 block text-sm font-bold text-gray-700"
                >
                  AWB Number *
                </label>
                <input
                  type="text"
                  name="tracking_number"
                  id="tracking_number"
                  placeholder="Enter the AWB from Trivara"
                  defaultValue={initialAwb || ""}
                  required
                  className="block w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm transition-all focus:border-transparent focus:bg-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-lg bg-gray-100 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
                >
                  Cancel
                </button>
                <FulfillButton disabled={!canFulfill} />
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
