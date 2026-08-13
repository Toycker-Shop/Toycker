"use client"

import { useReducer, useCallback, useMemo } from "react"
import { isValidIndianPincode } from "@lib/util/indian-pincode"

// Types for addresses matching your Supabase schema
export interface Address {
  first_name: string
  last_name: string
  address_1: string
  address_2?: string | null
  city: string
  province?: string | null
  postal_code: string
  country_code: string
  phone?: string | null
}

// Checkout state interface
export interface CheckoutState {
  email: string | null
  shippingAddress: Address | null
  billingAddress: Address | null
  paymentMethod: string | null
  shippingSameAsBilling: boolean
  saveAddress: boolean
  rewardsToApply: number
  isValid: boolean
}

// Action types using discriminated unions
export type CheckoutAction =
  | { type: "SET_EMAIL"; payload: string }
  | { type: "SET_SHIPPING_ADDRESS"; payload: Address }
  | { type: "SET_BILLING_ADDRESS"; payload: Address }
  | { type: "SET_PAYMENT_METHOD"; payload: string }
  | { type: "TOGGLE_SHIPPING_SAME_AS_BILLING" }
  | { type: "SET_SAVE_ADDRESS"; payload: boolean }
  | { type: "SET_REWARDS_TO_APPLY"; payload: number }
  | { type: "RESET" }

// Initial state
const initialState: CheckoutState = {
  email: null,
  shippingAddress: null,
  billingAddress: null,
  paymentMethod: null,
  shippingSameAsBilling: true,
  saveAddress: true,
  rewardsToApply: 0,
  isValid: false,
}

export function isAddressValid(address: Address | null): boolean {
  if (!address) return false
  return !!(
    address.first_name &&
    address.last_name &&
    address.address_1 &&
    address.city &&
    isValidIndianPincode(address.postal_code) &&
    address.country_code
  )
}

function hasAddressPhone(address: Address | null): boolean {
  return Boolean(address?.phone?.trim())
}

function areAddressesEqual(
  addressA: Address | null,
  addressB: Address | null
): boolean {
  if (!addressA || !addressB) return false

  return (
    addressA.first_name === addressB.first_name &&
    addressA.last_name === addressB.last_name &&
    addressA.address_1 === addressB.address_1 &&
    addressA.address_2 === addressB.address_2 &&
    addressA.city === addressB.city &&
    addressA.province === addressB.province &&
    addressA.postal_code === addressB.postal_code &&
    addressA.country_code === addressB.country_code &&
    addressA.phone === addressB.phone
  )
}

function inferShippingSameAsBilling(state: CheckoutState): boolean {
  if (!state.billingAddress || !state.shippingAddress) {
    return true
  }

  return areAddressesEqual(state.shippingAddress, state.billingAddress)
}

function createSeparateShippingAddress(address: Address | null): Address | null {
  if (!address) {
    return null
  }

  return {
    ...address,
    phone: null,
  }
}

function withMirroredShipping(state: CheckoutState): CheckoutState {
  if (!state.shippingSameAsBilling) {
    return state
  }

  const sharedAddress = state.billingAddress ?? state.shippingAddress

  return {
    ...state,
    billingAddress: sharedAddress,
    shippingAddress: sharedAddress,
  }
}

function computeCheckoutValidity(state: CheckoutState): boolean {
  const normalizedState = withMirroredShipping(state)
  const hasValidBilling = isAddressValid(normalizedState.billingAddress)
  const hasValidShipping = normalizedState.shippingSameAsBilling
    ? hasValidBilling && hasAddressPhone(normalizedState.shippingAddress)
    : isAddressValid(normalizedState.shippingAddress) &&
      hasAddressPhone(normalizedState.shippingAddress)

  return Boolean(
    normalizedState.email?.trim() &&
      hasValidShipping &&
      hasValidBilling &&
      normalizedState.paymentMethod
  )
}

function withComputedValidity(state: CheckoutState): CheckoutState {
  const normalizedState = withMirroredShipping(state)

  return {
    ...normalizedState,
    isValid: computeCheckoutValidity(normalizedState),
  }
}

function createInitialCheckoutState(
  initialData?: Partial<CheckoutState>
): CheckoutState {
  const state = initialData
    ? { ...initialState, ...initialData }
    : { ...initialState }

  if (initialData?.shippingSameAsBilling === undefined) {
    state.shippingSameAsBilling = inferShippingSameAsBilling(state)
  }

  return withComputedValidity(state)
}

// Reducer function
function checkoutReducer(
  state: CheckoutState,
  action: CheckoutAction
): CheckoutState {
  switch (action.type) {
    case "SET_EMAIL": {
      return withComputedValidity({
        ...state,
        email: action.payload,
      })
    }

    case "SET_SHIPPING_ADDRESS": {
      return withComputedValidity({
        ...state,
        shippingAddress: action.payload,
      })
    }

    case "SET_BILLING_ADDRESS": {
      return withComputedValidity({
        ...state,
        billingAddress: action.payload,
        shippingAddress: state.shippingSameAsBilling
          ? action.payload
          : state.shippingAddress,
      })
    }

    case "SET_PAYMENT_METHOD": {
      return withComputedValidity({
        ...state,
        paymentMethod: action.payload,
      })
    }

    case "TOGGLE_SHIPPING_SAME_AS_BILLING": {
      const shippingSameAsBilling = !state.shippingSameAsBilling
      return withComputedValidity({
        ...state,
        shippingSameAsBilling,
        shippingAddress: shippingSameAsBilling
          ? state.billingAddress ?? state.shippingAddress
          : createSeparateShippingAddress(
              state.shippingAddress ?? state.billingAddress
            ),
      })
    }

    case "SET_SAVE_ADDRESS": {
      return {
        ...state,
        saveAddress: action.payload,
      }
    }

    case "SET_REWARDS_TO_APPLY": {
      return {
        ...state,
        rewardsToApply: action.payload,
      }
    }

    case "RESET":
      return initialState

    default:
      return state
  }
}

// Custom hook
export function useCheckoutState(initialData?: Partial<CheckoutState>) {
  const [state, dispatch] = useReducer(
    checkoutReducer,
    initialData,
    createInitialCheckoutState
  )

  // Memoized helper functions
  const setEmail = useCallback((email: string) => {
    dispatch({ type: "SET_EMAIL", payload: email })
  }, [])

  const setShippingAddress = useCallback((address: Address) => {
    dispatch({ type: "SET_SHIPPING_ADDRESS", payload: address })
  }, [])

  const setBillingAddress = useCallback((address: Address) => {
    dispatch({ type: "SET_BILLING_ADDRESS", payload: address })
  }, [])

  const setPaymentMethod = useCallback((method: string) => {
    dispatch({ type: "SET_PAYMENT_METHOD", payload: method })
  }, [])

  const toggleShippingSameAsBilling = useCallback(() => {
    dispatch({ type: "TOGGLE_SHIPPING_SAME_AS_BILLING" })
  }, [])

  const setSaveAddress = useCallback((save: boolean) => {
    dispatch({ type: "SET_SAVE_ADDRESS", payload: save })
  }, [])

  const setRewardsToApply = useCallback((points: number) => {
    dispatch({ type: "SET_REWARDS_TO_APPLY", payload: points })
  }, [])

  const reset = useCallback(() => {
    dispatch({ type: "RESET" })
  }, [])

  // Memoized return object
  return useMemo(
    () => ({
      state,
      setEmail,
      setShippingAddress,
      setBillingAddress,
      setPaymentMethod,
      toggleShippingSameAsBilling,
      setSaveAddress,
      setRewardsToApply,
      reset,
    }),
    [
      state,
      setEmail,
      setShippingAddress,
      setBillingAddress,
      setPaymentMethod,
      toggleShippingSameAsBilling,
      setSaveAddress,
      setRewardsToApply,
      reset,
    ]
  )
}
