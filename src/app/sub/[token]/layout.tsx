import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sephiroth · Subscription",
  description: "Sephiroth Orbit Pass — subscription page",
  robots: { index: false, follow: false },
};

export default function SubLayout({ children }: { children: React.ReactNode }) {
  return children;
}
