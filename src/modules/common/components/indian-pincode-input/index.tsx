"use client"

import React from "react"

import Input from "@modules/common/components/input"
import { sanitizeIndianPincode } from "@lib/util/indian-pincode"

type IndianPincodeInputProps = React.ComponentProps<typeof Input>

const IndianPincodeInput = React.forwardRef<
  HTMLInputElement,
  IndianPincodeInputProps
>(({ onChange, ...props }, ref) => {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const sanitizedValue = sanitizeIndianPincode(event.currentTarget.value)

    if (event.currentTarget.value !== sanitizedValue) {
      event.currentTarget.value = sanitizedValue
    }

    onChange?.(event)
  }

  return (
    <Input
      {...props}
      ref={ref}
      type="text"
      inputMode="numeric"
      pattern="[1-9][0-9]{5}"
      minLength={6}
      maxLength={6}
      autoComplete="postal-code"
      title="Enter a valid 6-digit Indian PIN code."
      onChange={handleChange}
    />
  )
})

IndianPincodeInput.displayName = "IndianPincodeInput"

export default IndianPincodeInput
