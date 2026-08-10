"use client"

import { useCallback, useState, useRef, useEffect } from "react"
import Image from "next/image"
import ReactCrop, { type Crop, type PixelCrop, } from "react-image-crop"
import "react-image-crop/dist/ReactCrop.css"
import { MagnifyingGlassIcon, SparklesIcon, PhotoIcon, CloudArrowUpIcon, CameraIcon } from "@heroicons/react/24/outline"
import { useImageSearchStore } from "@/lib/store/image-search-store"
import { useRouter } from "next/navigation"
import { ProductCardSkeleton } from "@modules/common/components/skeleton/product-grid-skeleton"
import { resizeImageCropFromElement } from "@/lib/util/image-processing"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { fixUrl } from "@lib/util/images"
import {
    SEARCH_IMAGE_CLIENT_MAX_DIMENSION,
    SEARCH_IMAGE_UPLOAD_QUALITY,
} from "@/lib/constants/search"
import VisualSearchCapture, { isCoarsePointerDevice } from "@modules/search/components/visual-search-capture"

// Define types for results based on the API response
interface SearchProduct {
    id: string
    title: string
    handle: string
    thumbnail: string | null
    price: {
        amount: number
        currencyCode: string
        formatted: string
    }
    stock_count: number
    relevance_score: number
}

interface SearchResults {
    products: SearchProduct[]
    metadata: {
        total: number
    }
}

export default function VisualSearchInterface() {
    const router = useRouter()
    const { previewUrl, file, setImage } = useImageSearchStore()
    const [crop, setCrop] = useState<Crop>()
    const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null)
    const [results, setResults] = useState<SearchResults | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [hasInteracted, setHasInteracted] = useState(false)
    const [isMounted, setIsMounted] = useState(false)
    const [isCaptureOpen, setIsCaptureOpen] = useState(false)
    const imgRef = useRef<HTMLImageElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const abortControllerRef = useRef<AbortController | null>(null)

    useEffect(() => {
        setIsMounted(true)

        return () => {
            abortControllerRef.current?.abort()
        }
    }, [])

    const handleSelectedImage = (selectedFile: File) => {
        abortControllerRef.current?.abort()
        setResults(null)
        setHasInteracted(false)
        setImage(selectedFile)
    }

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0]
        if (selectedFile) handleSelectedImage(selectedFile)
        e.target.value = ""
    }

    const triggerGalleryInput = () => {
        fileInputRef.current?.click()
    }

    const triggerFileInput = () => {
        if (isCoarsePointerDevice()) {
            setIsCaptureOpen(true)
            return
        }

        triggerGalleryInput()
    }

    // Initialize crop when image loads
    function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
        const { width, height } = e.currentTarget

        // Trim 8 pixels from all sides
        const trim = 8
        const initialCrop: Crop = {
            unit: "px",
            x: trim,
            y: trim,
            width: width - (trim * 2),
            height: height - (trim * 2)
        }

        const initialPixelCrop: PixelCrop = {
            unit: 'px',
            x: trim,
            y: trim,
            width: width - (trim * 2),
            height: height - (trim * 2)
        }

        setCrop(initialCrop)
        setCompletedCrop(initialPixelCrop)

        // Auto-trigger trimmed search on load via the useEffect
        setHasInteracted(true)
    }

    const performSearch = useCallback(async (forceFullImage = false, cropOverride?: PixelCrop) => {
        if (!file || !imgRef.current) return

        const targetCrop = cropOverride || completedCrop

        // If we are doing a crop search but no valid crop exists
        if (!forceFullImage && (!targetCrop || targetCrop.width <= 0)) return

        abortControllerRef.current?.abort()
        const controller = new AbortController()
        abortControllerRef.current = controller
        setLoading(true)
        setError(null)
        setHasInteracted(true)

        try {
            const image = imgRef.current
            const scaleX = image.naturalWidth / image.width
            const scaleY = image.naturalHeight / image.height

            const formData = new FormData()
            const naturalCrop = forceFullImage
                ? {
                    x: 0,
                    y: 0,
                    width: image.naturalWidth,
                    height: image.naturalHeight,
                }
                : {
                    x: Math.round((targetCrop?.x || 0) * scaleX),
                    y: Math.round((targetCrop?.y || 0) * scaleY),
                    width: Math.round((targetCrop?.width || image.width) * scaleX),
                    height: Math.round((targetCrop?.height || image.height) * scaleY),
                }
            const searchBlob = await resizeImageCropFromElement(
                image,
                naturalCrop,
                SEARCH_IMAGE_CLIENT_MAX_DIMENSION,
                SEARCH_IMAGE_UPLOAD_QUALITY
            )

            formData.append("image", searchBlob, "visual-search.jpg")

            const response = await fetch("/api/storefront/search/image", {
                method: "POST",
                body: formData,
                signal: controller.signal,
            })

            if (!response.ok) {
                const data = await response.json()
                if (data.error?.includes("PGRST202") || data.error?.includes("search_products_multimodal")) {
                    throw new Error("Database setup incomplete. Please run the SQL migration for multimodal search.")
                }
                throw new Error(data.error || "Search failed")
            }

            const data = await response.json()
            setResults(data)
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                return
            }

            setError(err instanceof Error ? err.message : "Something went wrong")
        } finally {
            if (abortControllerRef.current === controller) {
                abortControllerRef.current = null
                setLoading(false)
            }
        }
    }, [completedCrop, file])

    // Auto-search on crop completion ONLY after first interaction
    useEffect(() => {
        if (hasInteracted && completedCrop && completedCrop.width > 0 && completedCrop.height > 0) {
            const timer = setTimeout(() => performSearch(false), 500)
            return () => clearTimeout(timer)
        }
    }, [completedCrop, hasInteracted, performSearch])

    const captureDialog = (
        <VisualSearchCapture
            isOpen={isCaptureOpen}
            onClose={() => setIsCaptureOpen(false)}
            onCapture={(capturedFile) => {
                handleSelectedImage(capturedFile)
                setIsCaptureOpen(false)
            }}
            onChooseGallery={triggerGalleryInput}
        />
    )

    if (!isMounted) return null

    if (!previewUrl) {
        return (
            <div className="flex flex-col items-center justify-center py-32 px-6">
                {captureDialog}
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    accept="image/*"
                    className="hidden"
                />
                <div className="max-w-md w-full text-center space-y-8">
                    <div className="space-y-4">
                        <div className="mx-auto w-24 h-24 bg-primary/5 rounded-3xl flex items-center justify-center ring-1 ring-primary/10">
                            <CloudArrowUpIcon className="h-12 w-12 text-primary" />
                        </div>
                        <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Toy Finder</h2>
                        <p className="text-slate-500 text-lg">
                            Can&apos;t find the right words? Upload a photo to find matching toys instantly.
                        </p>
                    </div>

                    <div className="pt-4">
                        <button
                            onClick={triggerFileInput}
                            className="w-full sm:w-auto px-10 py-4 bg-primary text-white text-lg font-bold rounded-2xl shadow-xl shadow-primary/20 hover:bg-primary/90 hover:-translate-y-0.5 transition-all duration-300 flex items-center justify-center gap-3 mx-auto"
                        >
                            <PhotoIcon className="w-6 h-6" />
                            Select an Image
                        </button>

                        <button
                            onClick={() => router.push("/")}
                            className="mt-6 text-sm font-semibold text-slate-400 hover:text-slate-600 transition-colors"
                        >
                            Or go back to home
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="mx-auto max-w-[1400px] px-6 py-10">
            {captureDialog}
            <div className="flex flex-col gap-10 lg:flex-row">
                {/* Left: Cropper Area (1 Column) */}
                <div className="w-full lg:w-1/4">
                    <div className="sticky top-24">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                                    <SparklesIcon className="h-6 w-6 text-primary" />
                                    Toy Finder
                                </h1>
                                <p className="text-slate-500 text-sm mt-1">
                                    Adjust the selection to focus on a specific toy for better results.
                                </p>
                            </div>
                        </div>

                        <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-900 shadow-inner flex justify-center items-center">
                            <ReactCrop
                                crop={crop}
                                onChange={(c: Crop) => {
                                    setCrop(c)
                                    setHasInteracted(true)
                                }}
                                onComplete={(c: PixelCrop) => setCompletedCrop(c)}
                                className="max-h-[70vh]"
                            >
                                <img
                                    ref={imgRef}
                                    src={previewUrl}
                                    alt="Source"
                                    onLoad={onImageLoad}
                                    style={{ display: "block", maxWidth: "100%", maxHeight: "70vh", height: "auto" }}
                                />
                            </ReactCrop>
                        </div>

                        <div className="mt-6">
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileSelect}
                                accept="image/*"
                                className="hidden"
                            />
                            <button
                                onClick={triggerFileInput}
                                className="w-full flex items-center justify-center gap-2.5 px-6 py-4 bg-white border-2 border-primary/20 rounded-2xl text-primary font-bold hover:bg-primary/5 hover:border-primary/40 transition-all group"
                            >
                                <CameraIcon className="w-6 h-6 transition-transform group-hover:scale-110" />
                                Select an Image
                            </button>
                        </div>
                    </div>
                </div>

                {/* Right: Results Area (3 Columns) */}
                <div className="w-full lg:w-3/4">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-bold text-slate-900">
                            {loading
                                ? "Searching..."
                                : results
                                    ? `${results.products.length} Results Found`
                                    : hasInteracted ? "Searching..." : "Your results will appear here"}
                        </h2>
                        {error && <span className="text-sm font-medium text-red-500">{error}</span>}
                    </div>

                    {!hasInteracted && (
                        <div className="flex flex-col items-center justify-center py-32 text-center opacity-40">
                            <MagnifyingGlassIcon className="h-16 w-16 mb-4" />
                            <p className="text-lg">Select a toy in the image to start searching</p>
                        </div>
                    )}

                    {results && results.products.length > 0 && !loading && (
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                            {results.products.map((product) => (
                                <VisualSearchResultCard key={product.id} product={product} />
                            ))}
                        </div>
                    )}

                    {results && results.products.length === 0 && !loading && (
                        <div className="flex flex-col items-center justify-center py-32 text-center">
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 w-full">
                                <p className="text-lg font-semibold text-slate-900">No matches yet</p>
                                <p className="mt-2 text-sm text-slate-500">
                                    Try selecting a different part of the image or different lighting.
                                </p>
                            </div>
                        </div>
                    )}

                    {loading && (
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                            {[...Array(6)].map((_, i) => (
                                <ProductCardSkeleton key={i} />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

const VisualSearchResultCard = ({ product }: { product: SearchProduct }) => {
    const imageUrl = product.thumbnail ? fixUrl(product.thumbnail) : null
    const inStock = product.stock_count > 0

    return (
        <LocalizedClientLink
            href={`/products/${product.handle}`}
            prefetch={false}
            className="group block overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
            <div className="relative aspect-square w-full overflow-hidden bg-slate-100">
                {imageUrl ? (
                    <Image
                        src={imageUrl}
                        alt={product.title}
                        fill
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                    />
                ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-400">
                        No image
                    </div>
                )}
            </div>
            <div className="space-y-2 p-4">
                <h3 className="line-clamp-2 min-h-10 text-sm font-bold leading-tight text-slate-900">
                    {product.title}
                </h3>
                <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-bold text-[#E7353A]">
                        {product.price.formatted}
                    </span>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${inStock ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                        {inStock ? "In stock" : "Out of stock"}
                    </span>
                </div>
            </div>
        </LocalizedClientLink>
    )
}
