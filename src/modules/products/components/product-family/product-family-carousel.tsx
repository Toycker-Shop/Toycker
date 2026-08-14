"use client"

import { useCallback, useEffect, useState } from "react"
import useEmblaCarousel from "embla-carousel-react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { Product } from "@/lib/supabase/types"
import ProductPreview from "@modules/products/components/product-preview"

type ProductFamilyCarouselProps = {
  products: Product[]
  clubDiscountPercentage?: number
}

export default function ProductFamilyCarousel({
  products,
  clubDiscountPercentage,
}: ProductFamilyCarouselProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
  })
  const [canScrollPrev, setCanScrollPrev] = useState(false)
  const [canScrollNext, setCanScrollNext] = useState(false)

  const updateScrollState = useCallback(() => {
    if (!emblaApi) return

    setCanScrollPrev(emblaApi.canScrollPrev())
    setCanScrollNext(emblaApi.canScrollNext())
  }, [emblaApi])

  useEffect(() => {
    if (!emblaApi) return

    updateScrollState()
    emblaApi.on("select", updateScrollState)
    emblaApi.on("reInit", updateScrollState)

    return () => {
      emblaApi.off("select", updateScrollState)
      emblaApi.off("reInit", updateScrollState)
    }
  }, [emblaApi, updateScrollState])

  const scrollPrev = () => emblaApi?.scrollPrev()
  const scrollNext = () => emblaApi?.scrollNext()

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={scrollPrev}
          disabled={!canScrollPrev}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
          aria-label="Previous Product Family products"
          aria-controls="product-family-carousel"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={scrollNext}
          disabled={!canScrollNext}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
          aria-label="Next Product Family products"
          aria-controls="product-family-carousel"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div
        id="product-family-carousel"
        ref={emblaRef}
        className="overflow-hidden"
        tabIndex={0}
        aria-label="Product Family products"
      >
        <div className="-ml-3 flex touch-pan-y">
          {products.map((product) => (
            <div
              key={product.id}
              className="min-w-0 flex-[0_0_50%] pl-3 sm:flex-[0_0_33.333%]"
            >
              <div className="h-full rounded-2xl border border-slate-100 bg-slate-50/40 p-2 sm:p-2.5">
                <ProductPreview
                  product={product}
                  clubDiscountPercentage={clubDiscountPercentage}
                  showAction={false}
                  isMinimal
                  viewMode="grid-5"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}