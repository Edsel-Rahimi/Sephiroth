import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // /ref/<panel>/… proxies must keep their trailing slashes so the
  // reference panels' base paths resolve correctly (no 308 rewrite).
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
