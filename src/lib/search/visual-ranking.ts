import {
    SEARCH_IMAGE_EXACT_MATCH_MARGIN,
    SEARCH_IMAGE_EXACT_MATCH_THRESHOLD,
} from '@/lib/constants/search'

export interface VisualSearchScoredProduct {
    relevance_score: number
}

export function rankVisualSearchProducts<T extends VisualSearchScoredProduct>(
    products: readonly T[],
    exactThreshold = SEARCH_IMAGE_EXACT_MATCH_THRESHOLD,
    exactMargin = SEARCH_IMAGE_EXACT_MATCH_MARGIN,
): T[] {
    const rankedProducts = [...products].sort(
        (first, second) => second.relevance_score - first.relevance_score,
    )
    const [topProduct, secondProduct] = rankedProducts

    if (!topProduct) {
        return rankedProducts
    }

    const isExactCandidate =
        topProduct.relevance_score >= exactThreshold &&
        (!secondProduct ||
            topProduct.relevance_score - secondProduct.relevance_score >= exactMargin)

    return isExactCandidate
        ? [topProduct, ...rankedProducts.slice(1)]
        : rankedProducts
}
