"use server"

import { unstable_cache } from "next/cache"
import { createPublicClient } from "@/lib/supabase/public-server"
import { Category } from "@/lib/supabase/types"

const CATEGORIES_CACHE_TTL = 600

type CategoryRow = Omit<Category, "parent_category"> & {
  parent_category?: Category | Category[] | null
}

const firstRelation = <T,>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value ?? null
}

// Internal function for listCategories
const listCategoriesInternal = async (page: number = 1, limit: number = 20) => {
  const supabase = createPublicClient()
  const from = (page - 1) * limit
  const to = from + limit - 1

  const { data, error, count } = await supabase
    .from("categories")
    .select("id, name, handle, description, image_url", { count: "exact" })
    .range(from, to)

  if (error) {
    console.error("Error fetching categories:", error)
    return { categories: [], count: 0 }
  }

  return { categories: data as Category[], count: count || 0 }
}

export const listCategories = unstable_cache(
  listCategoriesInternal,
  ["categories", "list"],
  { revalidate: CATEGORIES_CACHE_TTL, tags: ["categories", "storefront-catalog"] }
)

// Internal function for getCategoryByHandle
const getCategoryByHandleInternal = async (categoryHandle: string[]): Promise<Category | null> => {
  const handle = categoryHandle[categoryHandle.length - 1]
  const supabase = createPublicClient()

  // Fetch the current category and its parent information
  const { data, error } = await supabase
    .from("categories")
    .select(`
      id,
      name,
      handle,
      description,
      parent_category_id,
      created_at,
      image_url,
      parent_category(
        id,
        name,
        handle,
        description,
        parent_category_id,
        created_at,
        image_url
      )
    `)
    .eq("handle", handle)
    .maybeSingle()

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error("Error fetching category:", error)
    }
    return null
  }

  const category = data as unknown as CategoryRow

  return {
    ...category,
    parent_category: firstRelation(category.parent_category) ?? undefined,
  }
}

export const getCategoryByHandle = unstable_cache(
  getCategoryByHandleInternal,
  ["categories", "handle"],
  { revalidate: CATEGORIES_CACHE_TTL, tags: ["categories", "storefront-catalog"] }
)
