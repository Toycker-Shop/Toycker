export const INDIAN_PINCODE_PATTERN = /^[1-9][0-9]{5}$/

export const INDIAN_PINCODE_ERROR =
  "Enter a valid 6-digit Indian PIN code."

export function isValidIndianPincode(value: string): boolean {
  return INDIAN_PINCODE_PATTERN.test(value)
}

export function sanitizeIndianPincode(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 6)
}

export function getValidIndianPincodeOrEmpty(
  value: string | null | undefined
): string {
  return value && isValidIndianPincode(value) ? value : ""
}
