import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Prisma's generated client (incl. the query engine binary) is loaded via
  // dynamic requires that the file tracer can miss — include it explicitly
  // so standalone builds carry a working engine.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/.prisma/client/**"],
  },
  // /ref/<panel>/… proxies must keep their trailing slashes so the
  // reference panels' base paths resolve correctly (no 308 rewrite).
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
