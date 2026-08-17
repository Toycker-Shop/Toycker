import { Metadata } from "next"

import StoreTemplate from "@modules/store/templates"

export const metadata: Metadata = {
  title: "Store",
  description: "Explore all of our products.",
}

export const revalidate = 300

import { getClubSettings } from "@lib/data/club"

export default async function StorePage() {
  const clubSettings = await getClubSettings()

  return (
    <StoreTemplate
      countryCode="in"
      clubDiscountPercentage={clubSettings?.discount_percentage}
    />
  )
}
