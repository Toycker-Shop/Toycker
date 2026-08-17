import { Metadata } from "next"
import { notFound } from "next/navigation"

import { getCategoryByHandle, listCategories } from "@lib/data/categories"
import CategoryTemplate from "@modules/categories/templates"
import { getClubSettings } from "@lib/data/club"

type Props = {
  params: Promise<{ category: string[] }>
}

export const revalidate = 300

export async function generateStaticParams() {
  const { categories } = await listCategories()

  if (!categories) {
    return []
  }

  const categoryHandles = categories.map((category) => category.handle)

  return categoryHandles.map((handle) => ({
    category: [handle],
  }))
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params
  try {
    const productCategory = await getCategoryByHandle(params.category)

    if (!productCategory) {
      notFound()
    }

    const title = productCategory.name + " | Toycker Store"

    const description = productCategory.description ?? `${title} category.`

    return {
      title: `${title} | Toycker Store`,
      description,
      alternates: {
        canonical: `${params.category.join("/")}`,
      },
    }
  } catch (error) {
    notFound()
  }
}

export default async function CategoryPage(props: Props) {
  const params = await props.params

  const productCategory = await getCategoryByHandle(params.category)

  if (!productCategory) {
    notFound()
  }

  const clubSettings = await getClubSettings()

  return (
    <CategoryTemplate
      category={productCategory}
      countryCode="in"
      clubDiscountPercentage={clubSettings?.discount_percentage}
    />
  )
}
