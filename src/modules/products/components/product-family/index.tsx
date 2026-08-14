import { listProductFamilyProducts } from "@lib/data/products"
import ProductFamilyCarousel from "./product-family-carousel"

type ProductFamilyProps = {
  productId: string
  clubDiscountPercentage?: number
}

export default async function ProductFamily({
  productId,
  clubDiscountPercentage,
}: ProductFamilyProps) {
  const familyProducts = await listProductFamilyProducts(productId)

  if (familyProducts.length === 0) {
    return null
  }

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      aria-labelledby="product-family-heading"
      data-testid="product-family"
    >
      <div className="mb-4">
        <h2
          id="product-family-heading"
          className="text-lg font-bold text-slate-900"
        >
          Product Family
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Explore similar products in this family.
        </p>
      </div>

      <ProductFamilyCarousel
        products={familyProducts}
        clubDiscountPercentage={clubDiscountPercentage}
      />
    </section>
  )
}
