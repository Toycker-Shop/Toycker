import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const DEFAULT_CHECKOUT_RETURN_URL = '/checkout?step=address'

function getSupabaseProjectRef(): string | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  if (!supabaseUrl) {
    return null
  }

  try {
    return new URL(supabaseUrl).hostname.split('.')[0] || null
  } catch {
    return null
  }
}

function hasSupabaseAuthCookie(request: NextRequest): boolean {
  const projectRef = getSupabaseProjectRef()

  if (!projectRef) {
    return false
  }

  const authCookiePrefix = `sb-${projectRef}-auth-token`

  return request.cookies
    .getAll()
    .some((cookie) => cookie.name === authCookiePrefix || cookie.name.startsWith(`${authCookiePrefix}.`))
}

function getCheckoutLoginReturnUrl(request: NextRequest): string {
  const cartId = request.cookies.get('toycker_cart_id')?.value?.trim()

  if (!cartId) {
    return DEFAULT_CHECKOUT_RETURN_URL
  }

  const params = new URLSearchParams({
    step: 'address',
    cartId,
  })

  return `/checkout?${params.toString()}`
}

export async function updateSession(request: NextRequest) {
  const hasAuthCookie = hasSupabaseAuthCookie(request)

  if (!hasAuthCookie) {
    if (request.nextUrl.pathname.startsWith('/checkout')) {
      const redirectUrl = new URL('/login', request.url)
      redirectUrl.searchParams.set('returnUrl', getCheckoutLoginReturnUrl(request))
      return NextResponse.redirect(redirectUrl)
    }

    return NextResponse.next({
      request,
    })
  }

  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          if (process.env.NODE_ENV === "development") {
            console.log("Proxy setAll cookies:", cookiesToSet.map(c => c.name))
          }
          cookiesToSet.forEach(({ name, value, options: _options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, {
              ...options,
              path: '/',
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'lax',
            })
          )
        },
      },
    }
  )

  // Use getClaims() for secure local JWT validation with asymmetric keys
  // This validates the JWT locally without a network call, improving performance
  // while maintaining security through cryptographic signature verification
  const { data, error } = await supabase.auth.getClaims()
  const user = data?.claims?.sub ? { id: data.claims.sub } : null

  // Log validation errors in development for debugging
  if (error && process.env.NODE_ENV === "development") {
    console.warn("JWT validation error in proxy:", error.message)
  }

  if (request.nextUrl.pathname.startsWith('/checkout') && !user) {
    const redirectUrl = new URL('/login', request.url)
    redirectUrl.searchParams.set('returnUrl', getCheckoutLoginReturnUrl(request))
    return NextResponse.redirect(redirectUrl)
  }

  return supabaseResponse
}

export async function proxy(request: NextRequest) {
  // CRITICAL: Bypass middleware for payment gateway callbacks to prevent auth errors on POST requests
  if (
    request.nextUrl.pathname.startsWith('/api/payu/callback') ||
    request.nextUrl.pathname.startsWith('/api/easebuzz/callback') ||
    request.nextUrl.pathname.startsWith('/api/easebuzz/webhook')
  ) {
    return NextResponse.next()
  }

  // Safety net removed as it causes issues with JS-based verification flow

  return await updateSession(request)
}

export const config = {
  matcher: [
    '/checkout/:path*',
    '/account/:path*',
    '/admin/:path*',
  ],
}
