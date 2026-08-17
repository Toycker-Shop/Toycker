import { Metadata } from "next"
import { notFound } from "next/navigation"

import { getCollectionByHandle, listCollections } from "@lib/data/collections"
import { Collection } from "@/lib/supabase/types"
import CollectionTemplate from "@modules/collections/templates"
import { getClubSettings } from "@lib/data/club"

type Props = {
  params: Promise<{ handle: string }>
}

export const PRODUCT_LIMIT = 12
export const revalidate = 300

export async function generateStaticParams() {
  const { collections } = await listCollections()

  if (!collections) {
    return []
  }

  return collections.map((collection: Collection) => ({
    handle: collection.handle,
  }))
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params
  const collection = await getCollectionByHandle(decodeURIComponent(params.handle))

  if (!collection) {
    notFound()
  }

  return {
    title: `${collection.title} | Toycker Store`,
    description: `${collection.title} collection`,
  }
}

export default async function CollectionPage(props: Props) {
  const params = await props.params

  const collection = await getCollectionByHandle(decodeURIComponent(params.handle))

  if (!collection) {
    notFound()
  }

  const clubSettings = await getClubSettings()

  return (
    <CollectionTemplate
      collection={collection}
      countryCode="in"
      clubDiscountPercentage={clubSettings?.discount_percentage}
    />
  )
}
