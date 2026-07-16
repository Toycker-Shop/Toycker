import { describe, expect, it } from "vitest"

import { canAcceptOrderForPayment } from "@/lib/util/customer-order-state"

type PaymentInput = Parameters<typeof canAcceptOrderForPayment>[0]

const buildPaymentInput = (
  overrides: Partial<PaymentInput>
): PaymentInput => ({
  payment_method: "",
  payment_status: "",
  metadata: null,
  ...overrides,
})

describe("canAcceptOrderForPayment", () => {
  it("allows COD orders before payment collection", () => {
    expect(
      canAcceptOrderForPayment(
        buildPaymentInput({
          payment_method: "cash_on_delivery",
          payment_status: "pending",
        })
      )
    ).toBe(true)
  })

  it("allows full online orders only after payment is captured or paid", () => {
    expect(
      canAcceptOrderForPayment(
        buildPaymentInput({
          payment_method: "pp_easebuzz_easebuzz",
          payment_status: "captured",
        })
      )
    ).toBe(true)

    expect(
      canAcceptOrderForPayment(
        buildPaymentInput({
          payment_method: "pp_payu_payu",
          payment_status: "paid",
        })
      )
    ).toBe(true)

    expect(
      canAcceptOrderForPayment(
        buildPaymentInput({
          payment_method: "pp_easebuzz_easebuzz",
          payment_status: "pending",
        })
      )
    ).toBe(false)
  })

  it("allows partial payment orders after advance payment is received", () => {
    expect(
      canAcceptOrderForPayment(
        buildPaymentInput({
          payment_method: "pp_easebuzz_partial_payment",
          payment_status: "partially_paid",
        })
      )
    ).toBe(true)

    expect(
      canAcceptOrderForPayment(
        buildPaymentInput({
          payment_method: "pp_easebuzz_partial_payment",
          payment_status: "pending",
        })
      )
    ).toBe(false)
  })

  it("uses pending payment session provider when payment method is missing", () => {
    expect(
      canAcceptOrderForPayment(
        buildPaymentInput({
          payment_method: "",
          payment_status: "pending",
          payment_collection: {
            payment_sessions: [
              {
                id: "session-easebuzz-pending",
                provider_id: "pp_easebuzz_easebuzz",
                status: "pending",
                amount: 100,
                data: {},
              },
            ],
          },
        })
      )
    ).toBe(false)

    expect(
      canAcceptOrderForPayment(
        buildPaymentInput({
          payment_method: "",
          payment_status: "pending",
          payment_collection: {
            payment_sessions: [
              {
                id: "session-cod-pending",
                provider_id: "pp_system_default",
                status: "pending",
                amount: 100,
                data: {},
              },
            ],
          },
        })
      )
    ).toBe(true)
  })
})