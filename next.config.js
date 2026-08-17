const checkEnvVariables = require("./check-env-variables")
const withSerwistInit = require("@serwist/next").default;

// Silence Serwist Turbopack warning as we have already disabled it in development
process.env.SERWIST_SUPPRESS_TURBOPACK_WARNING = "1";

checkEnvVariables()

const R2_PROTOCOL = process.env.NEXT_PUBLIC_R2_MEDIA_PROTOCOL || "https"
const R2_HOSTNAME = process.env.NEXT_PUBLIC_R2_MEDIA_HOSTNAME || "cdn.toycker.in"
const R2_PATHNAME = process.env.NEXT_PUBLIC_R2_MEDIA_PATHNAME || "/uploads/**"

const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
})

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV !== "production",
});

/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,

  // Remove console.logs in production (keep error/warn for debugging)
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'],
    } : false,
  },

  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  async headers() {
    return [
      {
        source: "/manifest.webmanifest",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, stale-while-revalidate=86400",
          },
        ],
      },
    ]
  },
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
      },
      {
        protocol: "https",
        hostname: "*.r2.dev",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "cdn.toycker.in",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "toycker.in",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "www.toycker.in",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.cdn.toycker.in",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
      ...(R2_HOSTNAME
        ? [
          {
            protocol: R2_PROTOCOL,
            hostname: R2_HOSTNAME,
            pathname: R2_PATHNAME,
          },
          {
            protocol: R2_PROTOCOL,
            hostname: `*.${R2_HOSTNAME}`,
            pathname: R2_PATHNAME,
          },
        ]
        : []),
    ],
    // Serve Cloudflare/R2 media directly instead of routing through Vercel
    // Image Optimization. This keeps live media available when Vercel image
    // transformation limits are reached.
    unoptimized: true,
  },
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "swiper",
      "@heroicons/react",
      "recharts",
      "@radix-ui/react-accordion",
      "@supabase/supabase-js",
      "react-intersection-observer",
    ],
  },
  // serverExternalPackages is stable in Next.js 15, moved out of experimental
  serverExternalPackages: ["require-in-the-middle", "import-in-the-middle"],
}

// Injected Sentry Configuration
const { withSentryConfig } = require("@sentry/nextjs");

const sentryWebpackPluginOptions = {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
};

const sentryOptions = {
  widenClientFileUpload: true,
  transpileClientSDK: true,
  tunnelRoute: "/monitoring",
  hideSourceMaps: true,
  disableLogger: true,
  automaticVercelMonitors: true,
};

module.exports = withSentryConfig(
  withSerwist(withBundleAnalyzer(nextConfig)),
  sentryWebpackPluginOptions,
  sentryOptions
);
