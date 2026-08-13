"use client"

import React, { useEffect, useMemo, useActionState } from "react"
import IndianPincodeInput from "@modules/common/components/indian-pincode-input"

import Input from "@modules/common/components/input"

import AccountInfo from "../account-info"
import { CustomerProfile, Region } from "@/lib/supabase/types"
import { addCustomerAddress, updateCustomerAddress } from "@lib/data/customer"
import CountrySelect from "@modules/checkout/components/country-select"
import { getValidIndianPincodeOrEmpty } from "@lib/util/indian-pincode"
import { getCheckoutPhoneValue } from "@/lib/util/customer-phone"

type MyInformationProps = {
  customer: CustomerProfile
  regions: Region[]
}

const ProfileBillingAddress: React.FC<MyInformationProps> = ({
  customer,
  regions,
}) => {
  const regionOptions = useMemo(() => {
    return (
      regions
        ?.map((region) => {
          return region.countries?.map((country) => ({
            value: country.iso_2,
            label: country.display_name,
          }))
        })
        .flat() || []
    )
  }, [regions])

  const [successState, setSuccessState] = React.useState(false)

  const billingAddress = customer.addresses?.find((addr) => addr.is_default_billing)
  const billingPhone =
    getCheckoutPhoneValue(customer.phone) ||
    getCheckoutPhoneValue(billingAddress?.phone)

  const [state, formAction] = useActionState(
    billingAddress ? updateCustomerAddress : addCustomerAddress,
    {
      success: false,
      error: null as string | null,
    }
  )

  const clearState = () => {
    setSuccessState(false)
  }

  useEffect(() => {
    setSuccessState(state.success)
  }, [state])

  const currentInfo = useMemo(() => {
    if (!billingAddress) {
      return "No billing address"
    }

    const country =
      regionOptions?.find(
        (country) => country?.value === billingAddress.country_code
      )?.label || billingAddress.country_code?.toUpperCase()

    return (
      <div className="flex flex-col font-semibold" data-testid="current-info">
        <span>
          {billingAddress.first_name} {billingAddress.last_name}
        </span>
        <span>{billingAddress.company}</span>
        <span>
          {billingAddress.address_1}
          {billingAddress.address_2 ? `, ${billingAddress.address_2}` : ""}
        </span>
        <span>
          {billingAddress.postal_code}, {billingAddress.city}
        </span>
        <span>{country}</span>
      </div>
    )
  }, [billingAddress, regionOptions])

  return (
    <form action={formAction} onReset={() => clearState()} className="w-full">
      <input type="hidden" name="addressId" value={billingAddress?.id || ""} />
      <input type="hidden" name="isDefaultBilling" value="true" />
      <input type="hidden" name="isDefaultShipping" value="false" />
      <AccountInfo
        label="Billing address"
        currentInfo={currentInfo}
        isSuccess={successState}
        isError={!!state.error}
        errorMessage={state.error || undefined}
        clearState={clearState}
        data-testid="account-billing-address-editor"
      >
        <div className="grid grid-cols-1 gap-y-2">
          <div className="grid grid-cols-2 gap-x-2">
            <Input
              label="First name"
              name="first_name"
              defaultValue={billingAddress?.first_name || undefined}
              required
              data-testid="billing-first-name-input"
            />
            <Input
              label="Last name"
              name="last_name"
              defaultValue={billingAddress?.last_name || undefined}
              required
              data-testid="billing-last-name-input"
            />
          </div>
          <Input
            label="Company"
            name="company"
            defaultValue={billingAddress?.company || undefined}
            data-testid="billing-company-input"
          />
          <Input
            key={billingPhone}
            label="Phone"
            name="phone"
            type="phone"
            autoComplete="phone"
            required
            defaultValue={billingPhone}
            readOnly
            data-testid="billing-phone-input"
          />
          <p className="text-xs text-gray-500">
            This phone is linked to your WhatsApp login and cannot be changed.
          </p>
          <Input
            label="Address"
            name="address_1"
            defaultValue={billingAddress?.address_1 || undefined}
            required
            data-testid="billing-address-1-input"
          />
          <Input
            label="Apartment, suite, etc."
            name="address_2"
            defaultValue={billingAddress?.address_2 || undefined}
            data-testid="billing-address-2-input"
          />
          <div className="grid grid-cols-[144px_1fr] gap-x-2">
            <IndianPincodeInput
              label="Postal code"
              name="postal_code"
              defaultValue={getValidIndianPincodeOrEmpty(billingAddress?.postal_code)}
              required
              data-testid="billing-postcal-code-input"
            />
            <Input
              label="City"
              name="city"
              defaultValue={billingAddress?.city || undefined}
              required
              data-testid="billing-city-input"
            />
          </div>
          <Input
            label="Province"
            name="province"
            defaultValue={billingAddress?.province || undefined}
            data-testid="billing-province-input"
          />
          <CountrySelect
            name="country_code"
            defaultValue={billingAddress?.country_code || "in"}
            region={regions?.[0]}
            required
            data-testid="billing-country-code-select"
          />
        </div>
      </AccountInfo>
    </form>
  )
}

export default ProfileBillingAddress
