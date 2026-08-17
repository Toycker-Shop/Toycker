import {
  getStorefrontPriceBounds,
  listPaginatedProducts,
} from "@lib/data/products"
import { Suspense } from "react"
import type { AvailabilityFilter } from "@modules/store/components/refinement-list/types"
import { ageCategories } from "@modules/layout/config/navigation"
import { StorefrontFiltersProvider } from "@modules/store/context/storefront-filters"
import ProductGridSection from "@modules/store/components/product-grid-section"
import { STORE_PRODUCT_PAGE_SIZE } from "@modules/store/constants"
import FilterDrawer from "@modules/store/components/filter-drawer"
import Breadcrumbs from "@modules/common/components/breadcrumbs"
import { resolveCollectionIdentifier } from "@modules/store/utils/collection"

const StoreTemplate = async ({
  countryCode,
  clubDiscountPercentage,
}: {
  countryCode: string
  clubDiscountPercentage?: number
}) => {
  const ageCollectionEntries = await Promise.all(
    ageCategories.map(async (age) => {
      const resolved = await resolveCollectionIdentifier(age.href)
      return [age.id, resolved] as const
    })
  )

  const ageCollectionMap = new Map(
    ageCollectionEntries.filter(([, id]) => Boolean(id)) as [string, string][]
  )

  const [productListing, initialPriceBounds] = await Promise.all([
    listPaginatedProducts({
      page: 1,
      limit: STORE_PRODUCT_PAGE_SIZE,
      sortBy: "featured",
      countryCode,
    }),
    getStorefrontPriceBounds({
      countryCode,
    }),
  ])

  const {
    response: { products: initialProducts, count: initialCount },
  } = productListing

  const ageOptions = ageCategories.map((age) => ({
    value: age.id,
    label: age.label,
    collectionId: ageCollectionMap.get(age.id),
  }))

  const availabilityOptions = [
    {
      value: "in_stock" as AvailabilityFilter,
      label: "In stock",
    },
    {
      value: "out_of_stock" as AvailabilityFilter,
      label: "Out of stock",
    },
  ]

  return (
    <Suspense fallback={null}>
      <StorefrontFiltersProvider
        countryCode={countryCode}
        initialFilters={{ sortBy: "featured", page: 1, viewMode: "grid-4" }}
        initialProducts={initialProducts}
        initialCount={initialCount}
        initialPriceBounds={initialPriceBounds}
        pageSize={STORE_PRODUCT_PAGE_SIZE}
      >
        <FilterDrawer
          selectedFilters={{}}
          filterOptions={{ availability: availabilityOptions, ages: ageOptions }}
        >
          <div className="mx-auto p-4 max-w-[1440px] pb-10 w-full" data-testid="category-container" id="store-catalog">
            <Breadcrumbs
              items={[{ label: "Store" }]}
              className="mb-6 hidden small:block"
            />
            <h1 className="mb-4 text-3xl font-semibold text-slate-900" data-testid="store-page-title">
              All products
            </h1>
            <ProductGridSection
              title="All products"
              products={initialProducts}
              totalCount={initialCount}
              page={1}
              viewMode="grid-4"
              sortBy="featured"
              pageSize={STORE_PRODUCT_PAGE_SIZE}
              totalCountHint={initialCount}
              clubDiscountPercentage={clubDiscountPercentage}
            />
          </div>
        </FilterDrawer>
      </StorefrontFiltersProvider>
    </Suspense>
  )
}

export default StoreTemplate
