import type { NextConfig } from "next";

// Single-user local app: no auth rewrites, no standalone output, no telemetry
// endpoints. The server listens on 127.0.0.1 only (see package.json scripts).
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: {
    // Type-checking runs separately via `npm run type-check`.
    ignoreBuildErrors: true,
  },
  devIndicators: false,
};

export default nextConfig;
