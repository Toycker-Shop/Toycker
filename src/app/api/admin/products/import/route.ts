import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { CsvProductRow, ImportStats } from "@/lib/types/import"
import Papa from "papaparse"
import { revalidatePath, revalidateTag } from "next/cache"
import {
    validateMediaUrlList,
    validateNoSupabaseStorageMediaUrl,
} from "@/lib/util/media-url"

// Set max duration to 5 mins only for Vercel/similar (Next.js config)
export const maxDuration = 300

const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024
const MAX_IMPORT_ROWS = 1000
const EXPECTED_CSV_COLUMNS = [
    "Handle",
    "Title",
    "Description",
    "Short Description",
    "Subtitle",
    "Status",
    "Product Type",
    "Thumbnail URL",
    "Image URLs",
    "Video URL",
    "Category Handles",
    "Collection Handles",
    "Currency",
    "SKU",
    "Price",
    "Compare At Price",
    "Stock",
    "Barcode",
    "Option 1 Name",
    "Option 1 Value",
    "Option 2 Name",
    "Option 2 Value",
    "Option 3 Name",
    "Option 3 Value",
] as const

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function isCsvFile(file: File): boolean {
    const lowerName = file.name.toLowerCase()
    return lowerName.endsWith(".csv") || file.type === "text/csv" || file.type === "application/vnd.ms-excel"
}

function splitImageUrls(value: string | undefined): string[] {
    if (!value) {
        return []
    }

    return value.split(";").map((url) => url.trim()).filter(Boolean)
}

function validateCsvMediaUrls(row: CsvProductRow, handle: string): void {
    validateNoSupabaseStorageMediaUrl(
        row["Thumbnail URL"] || null,
        `Product ${handle} thumbnail`
    )
    validateMediaUrlList(
        splitImageUrls(row["Image URLs"]),
        `Product ${handle} images`
    )
    validateNoSupabaseStorageMediaUrl(
        row["Video URL"] || null,
        `Product ${handle} video`
    )
}

function validateCsvHeaders(fields: string[] | undefined): string | null {
    if (!fields || fields.length === 0) {
        return "CSV header row is missing."
    }

    const expected = [...EXPECTED_CSV_COLUMNS]
    const missing = expected.filter((column) => !fields.includes(column))
    const unknown = fields.filter((field) => !expected.includes(field as typeof EXPECTED_CSV_COLUMNS[number]))

    if (missing.length > 0) {
        return `Missing columns: ${missing.join(", ")}.`
    }

    if (unknown.length > 0) {
        return `Unexpected columns: ${unknown.join(", ")}.`
    }

    return null
}

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()

        // 1. Auth Check
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

        const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
        if (profile?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

        // 2. Parse File
        const formData = await request.formData()
        const uploadedFile = formData.get("file")

        if (!(uploadedFile instanceof File)) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 })
        }

        if (!isCsvFile(uploadedFile)) {
            return NextResponse.json({ error: "Only CSV files are supported" }, { status: 400 })
        }

        if (uploadedFile.size > MAX_IMPORT_FILE_SIZE_BYTES) {
            return NextResponse.json(
                { error: "CSV file is too large", details: "Maximum allowed file size is 5MB." },
                { status: 400 }
            )
        }

        const csvText = await uploadedFile.text()
        const parseResult = Papa.parse<CsvProductRow>(csvText, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (header) => header.trim() // Trim header whitespace
        })

        if (parseResult.errors.length > 0) {
            return NextResponse.json({
                error: "Invalid CSV format",
                details: parseResult.errors[0].message
            }, { status: 400 })
        }

        const headerError = validateCsvHeaders(parseResult.meta.fields)
        if (headerError) {
            return NextResponse.json({
                error: "Invalid CSV template",
                details: headerError,
            }, { status: 400 })
        }

        const rows = parseResult.data
        if (rows.length === 0) {
            return NextResponse.json({ error: "Empty CSV" }, { status: 400 })
        }

        if (rows.length > MAX_IMPORT_ROWS) {
            return NextResponse.json(
                {
                    error: "CSV has too many rows",
                    details: `Maximum allowed rows per import is ${MAX_IMPORT_ROWS}.`,
                },
                { status: 400 }
            )
        }

        // 3. Group by Handle
        const groups = new Map<string, CsvProductRow[]>()
        rows.forEach(row => {
            if (!row.Handle) return // Skip rows without handle
            const handle = row.Handle.trim()
            if (!groups.has(handle)) groups.set(handle, [])
            groups.get(handle)!.push(row)
        })

        const stats: ImportStats = {
            productsCreated: 0,
            productsUpdated: 0,
            variantsCreated: 0,
            variantsUpdated: 0,
            categoriesFoundOrCreated: 0,
            collectionsFoundOrCreated: 0,
            errors: []
        }

        // 4. Process Groups
        // Use Array.from to fix TS iteration error on Map
        for (const [handle, groupRows] of Array.from(groups)) {
            try {
                // Determine Product Data (use first row as master)
                const master = groupRows[0]
                validateCsvMediaUrls(master, handle)
                const imageUrls = splitImageUrls(master["Image URLs"])

                // === A. Upsert Product ===

                // Check if exists
                const existingProductCheck = await supabase
                    .from("products")
                    .select("id")
                    .eq("handle", handle)
                    .single()

                const isUpdate = !!existingProductCheck.data
                let productId = existingProductCheck.data?.id

                // Prepare Data
                const productData = {
                    handle: handle,
                    name: master.Title || handle,
                    description: master.Description || "",
                    short_description: master["Short Description"] || "",
                    subtitle: master.Subtitle || "",
                    status: (master.Status?.toLowerCase() === "active" ? "active" :
                        master.Status?.toLowerCase() === "archived" ? "archived" : "draft"),
                    thumbnail: master["Thumbnail URL"] || null,
                    images: imageUrls.length > 0 ? imageUrls : null,
                    video_url: master["Video URL"] || null,
                    currency_code: master.Currency?.toLowerCase() || "inr",
                    // We calculate base price/stock later from variants or use master row default
                    price: master.Price ? Number(master.Price) : 0,
                    stock_count: master.Stock ? Number(master.Stock) : 0,
                    image_url: master["Thumbnail URL"] || imageUrls[0] || null
                }

                if (isUpdate && productId) {
                    await supabase.from("products").update(productData).eq("id", productId)
                    stats.productsUpdated++
                } else {
                    const { data: newProd, error: insertError } = await supabase
                        .from("products")
                        .insert(productData)
                        .select("id")
                        .single()

                    if (insertError) throw new Error(`Product insert failed: ${insertError.message}`)
                    productId = newProd.id
                    stats.productsCreated++
                }

                // === B. Relations (Categories/Collections) ===

                // Categories
                if (master["Category Handles"]) {
                    const catHandles = master["Category Handles"].split(";").map((s: string) => s.trim()).filter(Boolean)
                    for (const catHandle of catHandles) {
                        // Find category ID
                        const { data: cat } = await supabase.from("categories").select("id").eq("handle", catHandle).single()
                        if (cat) {
                            // Link
                            await supabase.from("product_categories").upsert(
                                { product_id: productId, category_id: cat.id },
                                { onConflict: "product_id, category_id" }
                            )
                            stats.categoriesFoundOrCreated++ // Just counting links here really
                        }
                    }
                }

                // Collections
                if (master["Collection Handles"]) {
                    const colHandles = master["Collection Handles"].split(";").map((s: string) => s.trim()).filter(Boolean)
                    for (const colHandle of colHandles) {
                        // Find collection ID
                        const { data: col } = await supabase.from("collections").select("id").eq("handle", colHandle).single()
                        if (col) {
                            // Link
                            await supabase.from("product_collections").upsert(
                                { product_id: productId, collection_id: col.id },
                                { onConflict: "product_id, collection_id" }
                            )
                            stats.collectionsFoundOrCreated++
                        }
                    }
                }

                // === C. Variants ===
                const isSingle = master["Product Type"]?.toLowerCase() === "single" || (!master["Product Type"] && groupRows.length === 1)

                if (isSingle) {
                    // For single products, we ensure NO variants exist in the DB
                    await supabase.from("product_variants").delete().eq("product_id", productId)

                    // Price and Stock are already set on the product record in step A
                } else {
                    // For variable products, process variants from rows
                    for (const row of groupRows) {
                        const sku = row.SKU || `${handle}-${Math.random().toString(36).substring(7)}` // Fallback SKU

                        const options = []
                        if (row["Option 1 Name"]) options.push({ name: row["Option 1 Name"], value: row["Option 1 Value"] })
                        if (row["Option 2 Name"]) options.push({ name: row["Option 2 Name"], value: row["Option 2 Value"] })
                        if (row["Option 3 Name"]) options.push({ name: row["Option 3 Name"], value: row["Option 3 Value"] })

                        const variantData = {
                            product_id: productId,
                            sku: sku,
                            title: options.length > 0 ? options.map(o => o.value).join(" / ") : (row.Title || "Default"),
                            price: Number(row.Price) || 0,
                            compare_at_price: row["Compare At Price"] ? Number(row["Compare At Price"]) : null,
                            inventory_quantity: Number(row.Stock) || 0,
                            barcode: row.Barcode || null,
                            options: options, // JSONB
                            manage_inventory: true
                        }

                        // Try to find variant by SKU or Title
                        let variantId = null
                        if (row.SKU) {
                            const existingVar = await supabase.from("product_variants").select("id").eq("sku", row.SKU).single()
                            variantId = existingVar.data?.id
                        }

                        if (!variantId) {
                            // Fallback: match by title within this product
                            const titleToMatch = options.length > 0 ? options.map(o => o.value).join(" / ") : (row.Title || "Default")
                            const { data: matchedVar } = await supabase
                                .from("product_variants")
                                .select("id")
                                .eq("product_id", productId)
                                .eq("title", titleToMatch)
                                .maybeSingle()
                            variantId = matchedVar?.id
                        }

                        if (variantId) {
                            await supabase.from("product_variants").update(variantData).eq("id", variantId)
                            stats.variantsUpdated++
                        } else {
                            await supabase.from("product_variants").insert(variantData)
                            stats.variantsCreated++
                        }
                    }

                    // Update total stock count and min price on product (for variable products)
                    const { data: allVars } = await supabase.from("product_variants")
                        .select("inventory_quantity, price")
                        .eq("product_id", productId)

                    if (allVars && allVars.length > 0) {
                        const totalStock = allVars.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0)
                        const minPrice = Math.min(...allVars.map(v => v.price))

                        await supabase.from("products").update({
                            stock_count: totalStock,
                            price: minPrice
                        }).eq("id", productId)
                    }
                }

            } catch (err) {
                const message = getErrorMessage(err)
                console.error(`Error processing handle ${handle}:`, message)
                stats.errors.push(`Handle ${handle}: ${message}`)
            }
        }

        revalidatePath("/admin/products")
        revalidatePath("/")
        revalidateTag("storefront-catalog", "max")

        return NextResponse.json({
            success: true,
            ...stats
        })

    } catch (error) {
        const message = getErrorMessage(error)
        console.error("Global import error:", message)
        return NextResponse.json({ error: "Server error", details: message }, { status: 500 })
    }
}
