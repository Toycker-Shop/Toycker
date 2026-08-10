import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateImageEmbedding } from "@/lib/ml/embeddings"
import {
    SEARCH_IMAGE_MAX_UPLOAD_BYTES,
    SEARCH_IMAGE_MATCH_THRESHOLD,
    SEARCH_IMAGE_RESULT_LIMIT,
} from "@/lib/constants/search"
import {
    checkRequestRateLimit,
    getClientIpFromHeaders,
} from "@/lib/util/request-rate-limit"
import sharp from "sharp"

import { rankVisualSearchProducts } from '@/lib/search/visual-ranking'

interface SearchProduct {
    id: string
    name: string
    handle: string
    image_url: string | null
    thumbnail: string | null
    price: number
    currency_code: string
    stock_count: number
    relevance_score: number
}

const isDevelopment = process.env.NODE_ENV !== "production"
const IMAGE_SEARCH_RATE_LIMIT = 8
const IMAGE_SEARCH_RATE_LIMIT_WINDOW_MS = 60 * 1000

const logImageSearch = (message: string) => {
    if (isDevelopment) {
        console.log(message)
    }
}

async function processImage(inputBuffer: Buffer): Promise<Buffer> {
    try {
        return await sharp(inputBuffer, { failOnError: false })
            .resize(512, 512, {
                fit: "inside",
                withoutEnlargement: true,
            })
            .jpeg({
                quality: 90,
                mozjpeg: true,
                force: true,
            })
            .toBuffer()
    } catch (error) {
        logImageSearch(`Image cleanup strategy 1 failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    try {
        const pngBuffer = await sharp(inputBuffer, { failOnError: false })
            .png({ compressionLevel: 6, force: true })
            .toBuffer()

        return await sharp(pngBuffer)
            .resize(512, 512, { fit: "inside" })
            .jpeg({ quality: 90, mozjpeg: true })
            .toBuffer()
    } catch (error) {
        logImageSearch(`Image cleanup strategy 2 failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    try {
        return await sharp(inputBuffer, {
            failOnError: false,
            unlimited: true,
        })
            .withMetadata({ orientation: undefined })
            .rotate()
            .resize(512, 512, {
                fit: "inside",
                kernel: sharp.kernel.nearest,
            })
            .removeAlpha()
            .toColorspace("srgb")
            .jpeg({
                quality: 85,
                chromaSubsampling: "4:4:4",
                force: true,
            })
            .toBuffer()
    } catch (error) {
        logImageSearch(`Image cleanup strategy 3 failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    try {
        return await sharp(inputBuffer, {
            failOnError: false,
            unlimited: true,
            sequentialRead: true,
        })
            .resize(512, 512, { fit: "inside" })
            .toBuffer()
    } catch (error) {
        logImageSearch(`Image cleanup strategy 4 failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    throw new Error("Unable to process image. The file may be severely corrupted or in an unsupported format.")
}

export async function POST(request: Request) {
    try {
        const clientIp = getClientIpFromHeaders(request.headers)
        const rateLimit = checkRequestRateLimit({
            key: `storefront-image-search:${clientIp}`,
            limit: IMAGE_SEARCH_RATE_LIMIT,
            windowMs: IMAGE_SEARCH_RATE_LIMIT_WINDOW_MS,
        })

        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: "Too many image searches. Please wait a moment and try again." },
                {
                    status: 429,
                    headers: {
                        "Retry-After": String(rateLimit.retryAfterSeconds),
                        "X-RateLimit-Limit": String(IMAGE_SEARCH_RATE_LIMIT),
                        "X-RateLimit-Remaining": "0",
                    },
                }
            )
        }

        const formData = await request.formData()
        const imageFile = formData.get("image") as File | null

        if (!imageFile) {
            return NextResponse.json(
                { error: "No image provided" },
                { status: 400 }
            )
        }

        if (!(imageFile instanceof File)) {
            return NextResponse.json(
                { error: "Invalid image upload" },
                { status: 400 }
            )
        }

        if (imageFile.size > SEARCH_IMAGE_MAX_UPLOAD_BYTES) {
            return NextResponse.json(
                { error: "Image too large. Maximum size is 4MB." },
                { status: 400 }
            )
        }

        const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]
        if (!validTypes.includes(imageFile.type)) {
            return NextResponse.json(
                { error: "Invalid image type. Supported: JPEG, PNG, WebP, GIF" },
                { status: 400 }
            )
        }

        const arrayBuffer = await imageFile.arrayBuffer()
        const inputBuffer = Buffer.from(arrayBuffer)

        const x = formData.get("x") ? Math.round(Number(formData.get("x"))) : null
        const y = formData.get("y") ? Math.round(Number(formData.get("y"))) : null
        const width = formData.get("width") ? Math.round(Number(formData.get("width"))) : null
        const height = formData.get("height") ? Math.round(Number(formData.get("height"))) : null

        let processedBuffer = inputBuffer

        if (x !== null && y !== null && width !== null && height !== null && width > 0 && height > 0) {
            try {
                const metadata = await sharp(inputBuffer).metadata()
                const imgW = metadata.width || 0
                const imgH = metadata.height || 0

                const realX = Math.max(0, Math.min(x, imgW - 1))
                const realY = Math.max(0, Math.min(y, imgH - 1))
                const realW = Math.max(1, Math.min(width, imgW - realX))
                const realH = Math.max(1, Math.min(height, imgH - realY))

                processedBuffer = await sharp(inputBuffer)
                    .extract({ left: realX, top: realY, width: realW, height: realH })
                    .toBuffer()
            } catch (cropError) {
                logImageSearch(`Image crop failed, using full image: ${cropError instanceof Error ? cropError.message : String(cropError)}`)
            }
        }

        const cleanedBuffer = await processImage(processedBuffer)
        const embedding = await generateImageEmbedding(cleanedBuffer)

        const supabase = await createClient()
        const { data, error } = await supabase.rpc("search_products_multimodal", {
            search_query: null,
            search_embedding: embedding,
            match_threshold: SEARCH_IMAGE_MATCH_THRESHOLD,
            match_count: SEARCH_IMAGE_RESULT_LIMIT,
        })

        if (error) {
            console.error("Database search error:", error)
            throw new Error(`Database search failed: ${error.message}`)
        }

        const products = ((data || []) as SearchProduct[]).map((p) => ({
            id: p.id,
            title: p.name,
            handle: p.handle,
            thumbnail: p.image_url || p.thumbnail,
            price: {
                amount: p.price,
                currencyCode: p.currency_code || "INR",
                formatted: `\u20b9${p.price}`,
            },
            stock_count: p.stock_count,
            relevance_score: p.relevance_score,
        }))

        const rankedProducts = rankVisualSearchProducts(products)

        return NextResponse.json({
            products: rankedProducts,
            metadata: {
                total: rankedProducts.length,
                threshold: SEARCH_IMAGE_MATCH_THRESHOLD,
            },
        })
    } catch (error) {
        console.error("Image search error:", error)

        let userMessage = "Unable to process this image"
        if (error instanceof Error) {
            if (error.message.includes("Unable to process image")) {
                userMessage = "This image cannot be processed. Please try a different photo."
            } else if (error.message.includes("VipsJpeg") || error.message.includes("Corrupt")) {
                userMessage = "Image file is corrupted. Please try taking a new photo."
            } else if (error.message.includes("unsupported")) {
                userMessage = "Unsupported image format. Please use JPEG, PNG, or WebP."
            } else if (error.message.includes("Database search failed")) {
                userMessage = "Search temporarily unavailable. Please try again."
            }
        }

        return NextResponse.json(
            {
                error: userMessage,
                details: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        )
    }
}
