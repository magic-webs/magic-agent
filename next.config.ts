import type { NextConfig } from "next";

const convexSite = (
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL ||
  process.env.NEXT_PUBLIC_CONVEX_URL?.replace(".convex.cloud", ".convex.site") ||
  ""
).replace(/\/$/, "");

const proxiedPrefixes = [
  "/whatsapp",
  "/notify",
  "/apps",
  "/l",
  "/integrations/google",
  "/instagram",
  "/payments/razorpay",
  "/rcs",
  "/telegram",
  "/unsubscribe",
];

const nextConfig: NextConfig = {
  async rewrites() {
    if (!convexSite) return [];
    return proxiedPrefixes.map((prefix) => ({
      source: `${prefix}/:path*`,
      destination: `${convexSite}${prefix}/:path*`,
    }));
  },
  experimental: {
    // core-free-icons is a single barrel re-exporting 6031 icons, and every
    // page pulls from it. Without this, a dev rebuild walks the whole barrel
    // and rewrites far more chunks than the edit touched, which is what leaves
    // the browser holding module factories a new build no longer has. It is
    // not in Next's defaults.
    optimizePackageImports: ["@hugeicons/core-free-icons"],
  },
};

export default nextConfig;
