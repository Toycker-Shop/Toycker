import {
  getStorefrontPriceBounds,
  listPaginatedProducts,
} from "@lib/data/products"
import { Suspense } from "react"
import { Collection } from "@/lib/supabase/types"
import ProductGridSection from "@modules/store/components/product-grid-section"
import { StorefrontFiltersProvider } from "@modules/store/context/storefront-filters"
import { STORE_PRODUCT_PAGE_SIZE } from "@modules/store/constants"
import FilterDrawer from "@modules/store/components/filter-drawer"
import Breadcrumbs from "@modules/common/components/breadcrumbs"

export default async function CollectionTemplate({
  collection,
  countryCode,
  clubDiscountPercentage,
}: {
  collection: Collection
  countryCode: string
  clubDiscountPercentage?: number
}) {
  const queryParams = {
    collection_id: [collection.id],
  }

  const [productListing, initialPriceBounds] = await Promise.all([
    listPaginatedProducts({
      page: 1,
      limit: STORE_PRODUCT_PAGE_SIZE,
      sortBy: "featured",
      countryCode,
      queryParams,
    }),
    getStorefrontPriceBounds({
      countryCode,
      queryParams,
    }),
  ])
  const {
    response: { products: initialProducts, count: initialCount },
  } = productListing

  const availabilityOptions = [
    { value: "in_stock", label: "In stock" },
    { value: "out_of_stock", label: "Out of stock" },
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
        fixedCollectionId={collection.id}
      >
        <FilterDrawer
          selectedFilters={{}}
          filterOptions={{ availability: availabilityOptions }}
        >
          <div className="mx-auto p-4 max-w-[1440px] pb-10 w-full">
            <Breadcrumbs
              className="mb-6 hidden small:block"
              items={[
                { label: "Store", href: "/store" },
                { label: "Collections", href: "/collections" },
                { label: collection.title },
              ]}
            />
            <h1 className="mb-4 text-3xl font-semibold">{collection.title}</h1>
            <ProductGridSection
              title={collection.title}
              products={initialProducts}
              totalCount={initialCount}
              page={1}
              viewMode="grid-4"
              sortBy="featured"
              pageSize={STORE_PRODUCT_PAGE_SIZE}
              clubDiscountPercentage={clubDiscountPercentage}
            />
          </div>
        </FilterDrawer>
      </StorefrontFiltersProvider>
    </Suspense>
  )
}
