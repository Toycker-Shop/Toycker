import Checkbox from "@modules/common/components/checkbox"
import Input from "@modules/common/components/input"
import IndianPincodeInput from "@modules/common/components/indian-pincode-input"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { useDebounce } from "@lib/hooks/use-debounce"
import AddressSelect from "../address-select"
import CountrySelect from "../country-select"
import { useCheckout } from "../../context/checkout-context"
import { getCustomerFacingEmail } from "@/lib/util/customer-email"
import {
  getValidIndianPincodeOrEmpty,
  isValidIndianPincode,
} from "@lib/util/indian-pincode"
import { getCheckoutPhoneValue } from "@/lib/util/customer-phone"
import {
  Address as SavedAddress,
  Cart,
  CustomerProfile,
} from "@/lib/supabase/types"

type BillingFormData = {
  "billing_address.first_name": string
  "billing_address.last_name": string
  "billing_address.address_1": string
  "billing_address.company": string
  "billing_address.postal_code": string
  "billing_address.city": string
  "billing_address.country_code": string
  "billing_address.province": string
  "billing_address.phone": string
  email: string
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

function getDefaultCountryCode(
  cart: Cart | null,
  initialAddress?: AddressFormSource | null
) {
  return (
    initialAddress?.country_code ||
    cart?.billing_address?.country_code ||
    cart?.shipping_address?.country_code ||
    cart?.region?.countries?.[0]?.iso_2 ||
    "in"
  )
}

function buildFormData(
  cart: Cart | null,
  initialAddress: AddressFormSource | null,
  customerPhone: string,
  customerEmail: string
): BillingFormData {
  const billingPhone =
    customerPhone || getCheckoutPhoneValue(initialAddress?.phone)

  return {
    "billing_address.first_name": initialAddress?.first_name || "",
    "billing_address.last_name": initialAddress?.last_name || "",
    "billing_address.address_1": initialAddress?.address_1 || "",
    "billing_address.company":
      initialAddress?.company || initialAddress?.address_2 || "",
    "billing_address.postal_code": getValidIndianPincodeOrEmpty(
      initialAddress?.postal_code
    ),
    "billing_address.city": initialAddress?.city || "",
    "billing_address.country_code": getDefaultCountryCode(cart, initialAddress),
    "billing_address.province": initialAddress?.province || "",
    "billing_address.phone": billingPhone,
    email: customerEmail,
  }
}

const BillingAddress = ({
  customer,
  cart,
  checked,
  onChange,
}: {
  customer: CustomerProfile | null
  cart: Cart | null
  checked: boolean
  onChange: () => void
}) => {
  const {
    state,
    setBillingAddress,
    setEmail,
    setSaveAddress,
  } = useCheckout()
  const customerFacingCartEmail = getCustomerFacingEmail(cart?.email)
  const customerPhone = getCheckoutPhoneValue(customer?.phone)
  const isBillingPhoneLocked = Boolean(customer)
  const resolvedCheckoutEmail = customerFacingCartEmail || customer?.email || ""
  const defaultBillingAddress = customer?.addresses?.find(a => a.is_default_billing) ?? null
  const initialAddress =
    state.billingAddress ?? cart?.billing_address ?? cart?.shipping_address ?? defaultBillingAddress ?? null

  const [formData, setFormData] = useState<BillingFormData>(() =>
    buildFormData(cart, initialAddress, customerPhone, resolvedCheckoutEmail)
  )

  const [pincodeLoading, setPincodeLoading] = useState(false)
  const debouncedPincode = useDebounce(
    formData["billing_address.postal_code"],
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
  const selectableAddresses = useMemo(
    () =>
      addressesInRegion.map((address) => ({
        ...address,
        phone: customerPhone || getCheckoutPhoneValue(address.phone),
      })),
    [addressesInRegion, customerPhone]
  )

  const addressInput = useMemo<ComparableAddress>(
    () => ({
      first_name: formData["billing_address.first_name"],
      last_name: formData["billing_address.last_name"],
      address_1: formData["billing_address.address_1"],
      company: formData["billing_address.company"],
      postal_code: formData["billing_address.postal_code"],
      city: formData["billing_address.city"],
      country_code: formData["billing_address.country_code"],
      province: formData["billing_address.province"],
      phone: formData["billing_address.phone"],
    }),
    [formData]
  )

  const setFormAddress = useCallback(
    (address?: SavedAddress) => {
      if (!address) {
        return
      }

      setFormData((currentFormData) => ({
        ...currentFormData,
        "billing_address.first_name": address.first_name || "",
        "billing_address.last_name": address.last_name || "",
        "billing_address.address_1": address.address_1 || "",
        "billing_address.company": address.company || address.address_2 || "",
        "billing_address.postal_code": getValidIndianPincodeOrEmpty(
          address.postal_code
        ),
        "billing_address.city": address.city || "",
        "billing_address.country_code":
          address.country_code || getDefaultCountryCode(cart, address),
        "billing_address.province": address.province || "",
        "billing_address.phone":
          customerPhone || getCheckoutPhoneValue(address.phone),
      }))
    },
    [cart, customerPhone]
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
          "billing_address.city": data.city,
          "billing_address.province": data.state,
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
    setBillingAddress({
      first_name: formData["billing_address.first_name"],
      last_name: formData["billing_address.last_name"],
      address_1: formData["billing_address.address_1"],
      address_2: formData["billing_address.company"] || null,
      city: formData["billing_address.city"],
      province: formData["billing_address.province"] || null,
      postal_code: formData["billing_address.postal_code"],
      country_code: formData["billing_address.country_code"],
      phone: formData["billing_address.phone"] || null,
    })
  }, [formData, setBillingAddress])

  useEffect(() => {
    setEmail(formData.email)
  }, [formData.email, setEmail])

  return (
    <>
      {customer && selectableAddresses.length > 0 && (
        <div className="mb-4 sm:mb-6 flex flex-col gap-y-3 sm:gap-y-4 p-3 sm:p-5 border border-gray-200 rounded-lg">
          <p className="text-xs sm:text-sm">
            {`Hi ${customer.first_name}, do you want to use one of your saved addresses?`}
          </p>
          <AddressSelect
            addresses={selectableAddresses}
            addressInput={addressInput}
            onSelect={setFormAddress}
          />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <Input
          label="First name"
          name="billing_address.first_name"
          autoComplete="given-name"
          value={formData["billing_address.first_name"] || ""}
          onChange={handleChange}
          required
          data-testid="billing-first-name-input"
        />
        <Input
          label="Last name"
          name="billing_address.last_name"
          autoComplete="family-name"
          value={formData["billing_address.last_name"] || ""}
          onChange={handleChange}
          required
          data-testid="billing-last-name-input"
        />
        <Input
          label="Flat, House no., Building, Company"
          name="billing_address.address_1"
          autoComplete="address-line1"
          value={formData["billing_address.address_1"] || ""}
          onChange={handleChange}
          required
          data-testid="billing-address-input"
        />
        <Input
          label="Area, Colony, Street, Sector, Village"
          name="billing_address.company"
          value={formData["billing_address.company"] || ""}
          onChange={handleChange}
          autoComplete="organization"
          data-testid="billing-company-input"
        />
        <IndianPincodeInput
          label="Pincode"
          name="billing_address.postal_code"
          value={formData["billing_address.postal_code"] || ""}
          onChange={handleChange}
          required
          data-testid="billing-postal-input"
        />
        <Input
          label="City"
          name="billing_address.city"
          autoComplete="address-level2"
          value={formData["billing_address.city"] || ""}
          onChange={handleChange}
          disabled={pincodeLoading}
          required
          data-testid="billing-city-input"
        />
        <CountrySelect
          name="billing_address.country_code"
          autoComplete="country"
          region={cart?.region}
          value={formData["billing_address.country_code"]}
          onChange={handleChange}
          required
          data-testid="billing-country-select"
        />
        <Input
          label="State / Province"
          name="billing_address.province"
          autoComplete="address-level1"
          value={formData["billing_address.province"] || ""}
          onChange={handleChange}
          disabled={pincodeLoading}
          data-testid="billing-province-input"
        />
      </div>

      <div className="my-6 sm:my-8">
        <Checkbox
          label="Shipping address same as billing address"
          name="shipping_same_as_billing"
          checked={checked}
          onChange={onChange}
          data-testid="shipping-address-checkbox"
        />
      </div>

      {customer && (
        <div className="mb-6 sm:mb-8">
          <Checkbox
            label="Save address for future use"
            name="save_address"
            checked={state.saveAddress}
            onChange={() => setSaveAddress(!state.saveAddress)}
            data-testid="save-address-checkbox"
          />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-4">
        <Input
          label="Email"
          name="email"
          type="email"
          title="Enter a valid email address."
          autoComplete="email"
          value={formData.email || ""}
          onChange={handleChange}
          required
          data-testid="billing-email-input"
        />
        <Input
          label="Phone"
          name="billing_address.phone"
          autoComplete="tel"
          value={formData["billing_address.phone"] || ""}
          onChange={handleChange}
          readOnly={isBillingPhoneLocked}
          required
          data-testid="billing-phone-input"
        />
      </div>
      {isBillingPhoneLocked && (
        <p className="text-xs text-gray-500 mb-4">
          This phone is linked to your WhatsApp login and cannot be changed.
        </p>
      )}
    </>
  )
}

export default BillingAddress
