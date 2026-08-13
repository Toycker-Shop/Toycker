import Input from "@modules/common/components/input"
import IndianPincodeInput from "@modules/common/components/indian-pincode-input"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { useDebounce } from "@lib/hooks/use-debounce"
import AddressSelect from "../address-select"
import CountrySelect from "../country-select"
import { useCheckout } from "../../context/checkout-context"
import { getCheckoutPhoneValue } from "@/lib/util/customer-phone"
import {
  getValidIndianPincodeOrEmpty,
  isValidIndianPincode,
} from "@lib/util/indian-pincode"
import {
  Address as SavedAddress,
  Cart,
  CustomerProfile,
} from "@/lib/supabase/types"

type ShippingFormData = {
  "shipping_address.first_name": string
  "shipping_address.last_name": string
  "shipping_address.address_1": string
  "shipping_address.company": string
  "shipping_address.postal_code": string
  "shipping_address.city": string
  "shipping_address.country_code": string
  "shipping_address.province": string
  "shipping_address.phone": string
}

type ComparableAddress = Pick<
  SavedAddress,
  | "first_name"
  | "last_name"
  | "address_1"
  | "company"
  | "postal_code"
  | "city"
  | "country_code"
  | "province"
  | "phone"
>

type AddressFormSource = {
  first_name: string | null
  last_name: string | null
  address_1: string | null
  address_2?: string | null | undefined
  company?: string | null | undefined
  postal_code: string | null
  city: string | null
  country_code: string | null
  province?: string | null | undefined
  phone?: string | null | undefined
}

function buildFormData(
  cart: Cart | null,
  initialAddress: AddressFormSource | null
): ShippingFormData {
  return {
    "shipping_address.first_name": initialAddress?.first_name || "",
    "shipping_address.last_name": initialAddress?.last_name || "",
    "shipping_address.address_1": initialAddress?.address_1 || "",
    "shipping_address.company":
      initialAddress?.company || initialAddress?.address_2 || "",
    "shipping_address.postal_code": getValidIndianPincodeOrEmpty(
      initialAddress?.postal_code
    ),
    "shipping_address.city": initialAddress?.city || "",
    "shipping_address.country_code":
      initialAddress?.country_code ||
      cart?.shipping_address?.country_code ||
      cart?.billing_address?.country_code ||
      "in",
    "shipping_address.province": initialAddress?.province || "",
    "shipping_address.phone": getCheckoutPhoneValue(initialAddress?.phone),
  }
}

const ShippingAddress = ({
  customer,
  cart,
}: {
  customer: CustomerProfile | null
  cart: Cart | null
}) => {
  const { state, setShippingAddress } = useCheckout()
  const defaultShippingAddress = customer?.addresses?.find(a => a.is_default_shipping) ?? customer?.addresses?.find(a => a.is_default_billing) ?? null
  const initialAddress = state.shippingAddress ?? cart?.shipping_address ?? defaultShippingAddress ?? null

  const [formData, setFormData] = useState<ShippingFormData>(() =>
    buildFormData(cart, initialAddress)
  )

  const [pincodeLoading, setPincodeLoading] = useState(false)
  const debouncedPincode = useDebounce(
    formData["shipping_address.postal_code"],
    500
  )

  const countriesInRegion = useMemo(
    () => cart?.region?.countries?.map((country) => country.iso_2),
    [cart?.region]
  )

  const addressesInRegion = useMemo(
    () =>
      customer?.addresses.filter(
        (address) =>
          Boolean(address.country_code) &&
          (countriesInRegion?.includes(address.country_code!) ||
            address.country_code === "in")
      ) || [],
    [customer?.addresses, countriesInRegion]
  )

  const setFormAddress = useCallback(
    (address?: SavedAddress) => {
      if (!address) {
        return
      }

      setFormData((currentFormData) => ({
        ...currentFormData,
        "shipping_address.first_name": address.first_name || "",
        "shipping_address.last_name": address.last_name || "",
        "shipping_address.address_1": address.address_1 || "",
        "shipping_address.company": address.company || address.address_2 || "",
        "shipping_address.postal_code": getValidIndianPincodeOrEmpty(
          address.postal_code
        ),
        "shipping_address.city": address.city || "",
        "shipping_address.country_code":
          address.country_code ||
          cart?.shipping_address?.country_code ||
          cart?.billing_address?.country_code ||
          "in",
        "shipping_address.province": address.province || "",
        "shipping_address.phone": getCheckoutPhoneValue(address.phone),
      }))
    },
    [cart?.billing_address?.country_code, cart?.shipping_address?.country_code]
  )

  const addressInput = useMemo<ComparableAddress>(
    () => ({
      first_name: formData["shipping_address.first_name"],
      last_name: formData["shipping_address.last_name"],
      address_1: formData["shipping_address.address_1"],
      company: formData["shipping_address.company"],
      postal_code: formData["shipping_address.postal_code"],
      city: formData["shipping_address.city"],
      country_code: formData["shipping_address.country_code"],
      province: formData["shipping_address.province"],
      phone: formData["shipping_address.phone"],
    }),
    [formData]
  )

  useEffect(() => {
    if (!isValidIndianPincode(debouncedPincode)) return

    let cancelled = false
    setPincodeLoading(true)

    fetch(`/api/pincode/${debouncedPincode}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { city: string; state: string } | null) => {
        if (cancelled || !data) return
        setFormData((prev) => ({
          ...prev,
          "shipping_address.city": data.city,
          "shipping_address.province": data.state,
        }))
      })
      .finally(() => {
        if (!cancelled) setPincodeLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [debouncedPincode])

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    setFormData((currentFormData) => ({
      ...currentFormData,
      [e.target.name]: e.target.value,
    }))
  }

  useEffect(() => {
    setShippingAddress({
      first_name: formData["shipping_address.first_name"],
      last_name: formData["shipping_address.last_name"],
      address_1: formData["shipping_address.address_1"],
      address_2: formData["shipping_address.company"] || null,
      city: formData["shipping_address.city"],
      province: formData["shipping_address.province"] || null,
      postal_code: formData["shipping_address.postal_code"],
      country_code: formData["shipping_address.country_code"],
      phone: formData["shipping_address.phone"] || null,
    })
  }, [formData, setShippingAddress])

  return (
    <>
      {customer && addressesInRegion.length > 0 && (
        <div className="mb-4 sm:mb-6 flex flex-col gap-y-3 sm:gap-y-4 p-3 sm:p-5 border border-gray-200 rounded-lg">
          <p className="text-xs sm:text-sm">
            {`Hi ${customer.first_name}, do you want to use a saved delivery address?`}
          </p>
          <AddressSelect
            addresses={addressesInRegion}
            addressInput={addressInput}
            onSelect={setFormAddress}
          />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <Input
          label="First name"
          name="shipping_address.first_name"
          autoComplete="given-name"
          value={formData["shipping_address.first_name"] || ""}
          onChange={handleChange}
          required
          data-testid="shipping-first-name-input"
        />
        <Input
          label="Last name"
          name="shipping_address.last_name"
          autoComplete="family-name"
          value={formData["shipping_address.last_name"] || ""}
          onChange={handleChange}
          required
          data-testid="shipping-last-name-input"
        />
        <Input
          label="Flat, House no., Building, Company"
          name="shipping_address.address_1"
          autoComplete="address-line1"
          value={formData["shipping_address.address_1"] || ""}
          onChange={handleChange}
          required
          data-testid="shipping-address-input"
        />
        <Input
          label="Area, Colony, Street, Sector, Village"
          name="shipping_address.company"
          value={formData["shipping_address.company"] || ""}
          onChange={handleChange}
          autoComplete="organization"
          data-testid="shipping-company-input"
        />
        <IndianPincodeInput
          label="Pincode"
          name="shipping_address.postal_code"
          value={formData["shipping_address.postal_code"] || ""}
          onChange={handleChange}
          required
          data-testid="shipping-postal-code-input"
        />
        <Input
          label="City"
          name="shipping_address.city"
          autoComplete="address-level2"
          value={formData["shipping_address.city"] || ""}
          onChange={handleChange}
          required
          disabled={pincodeLoading}
          data-testid="shipping-city-input"
        />
        <CountrySelect
          name="shipping_address.country_code"
          autoComplete="country"
          region={cart?.region}
          value={formData["shipping_address.country_code"]}
          onChange={handleChange}
          required
          data-testid="shipping-country-select"
        />
        <Input
          label="State / Province"
          name="shipping_address.province"
          autoComplete="address-level1"
          value={formData["shipping_address.province"] || ""}
          onChange={handleChange}
          disabled={pincodeLoading}
          data-testid="shipping-province-input"
        />
        <Input
          label="Phone"
          name="shipping_address.phone"
          autoComplete="tel"
          value={formData["shipping_address.phone"] || ""}
          onChange={handleChange}
          required
          data-testid="shipping-phone-input"
        />
      </div>
    </>
  )
}

export default ShippingAddress
