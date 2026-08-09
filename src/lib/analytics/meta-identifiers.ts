"use client"

const META_VISITOR_ID_COOKIE = "toycker_meta_visitor_id"
const META_FBC_COOKIE = "_fbc"
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400

const getCookieValue = (name: string): string | undefined => {
  const cookiePrefix = `${name}=`
  const cookie = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(cookiePrefix))

  if (!cookie) return undefined

  const value = cookie.slice(cookiePrefix.length)
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const setCookie = (name: string, value: string): void => {
  const secureAttribute = window.location.protocol === "https:" ? "; Secure" : ""
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secureAttribute}`
}

const createVisitorId = (): string => {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  const randomValues = new Uint8Array(16)
  crypto.getRandomValues(randomValues)
  return Array.from(randomValues, (value) => value.toString(16).padStart(2, "0")).join("")
}

const preserveMetaClickId = (): void => {
  if (getCookieValue(META_FBC_COOKIE)) return

  const fbclid = new URLSearchParams(window.location.search).get("fbclid")?.trim()
  if (!fbclid) return

  setCookie(META_FBC_COOKIE, `fb.1.${Date.now()}.${fbclid}`)
}

export const ensureMetaMarketingIdentifiers = (): void => {
  if (typeof window === "undefined" || typeof document === "undefined") return

  if (!getCookieValue(META_VISITOR_ID_COOKIE)) {
    setCookie(META_VISITOR_ID_COOKIE, createVisitorId())
  }

  preserveMetaClickId()
}
