import type { Metadata } from "next";
import { resolveBrandNameForToken } from "@/lib/sub-groups";

/* ============================================================
   Task 1-b — white-label metadata for the public sub page.
   Token → user/group → reseller-or-panel brand NAME; any failure
   (unknown token, DB hiccup) falls back to the Sephiroth default.
   Only the brand name is resolved — never logo/accent or any
   other reseller internals.
   ============================================================ */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  let brandName: string | null = null;
  try {
    const { token } = await params;
    brandName = await resolveBrandNameForToken(token);
  } catch {
    brandName = null;
  }
  const name = brandName?.trim() || "Sephiroth";
  return {
    title: `${name} · Subscription`,
    description: `${name} Orbit Pass — subscription page`,
    robots: { index: false, follow: false },
  };
}

export default function SubLayout({ children }: { children: React.ReactNode }) {
  return children;
}
