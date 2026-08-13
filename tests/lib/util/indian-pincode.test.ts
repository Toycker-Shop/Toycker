import { describe, expect, it } from "vitest"

import {
  getValidIndianPincodeOrEmpty,
  isValidIndianPincode,
  sanitizeIndianPincode,
} from "@lib/util/indian-pincode"

describe("Indian PIN code validation", () => {
  it("accepts a valid six-digit Indian PIN code", () => {
    expect(isValidIndianPincode("390007")).toBe(true)
  })

  it.each(["", "39000", "3900079", "39A007", "390-007", " 390007"]) (
    "rejects invalid PIN code %j",
    (value) => {
      expect(isValidIndianPincode(value)).toBe(false)
    }
  )

  it("removes non-numeric characters and limits input to six digits", () => {
    expect(sanitizeIndianPincode("39A-0007999")).toBe("390007")
  })

  it("returns only valid existing values", () => {
    expect(getValidIndianPincodeOrEmpty("390007")).toBe("390007")
    expect(getValidIndianPincodeOrEmpty("390007999")).toBe("")
    expect(getValidIndianPincodeOrEmpty(null)).toBe("")
  })
})
