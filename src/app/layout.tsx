import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

// Self-hosted fonts (woff2 in ./fonts) — avoids network fetches at build time.
const vazirmatn = localFont({
  variable: "--font-vazir",
  display: "swap",
  src: [
    { path: "./fonts/Vazirmatn-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Vazirmatn-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Vazirmatn-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/Vazirmatn-Bold.woff2", weight: "700", style: "normal" },
  ],
});

const spaceGrotesk = localFont({
  variable: "--font-space",
  display: "swap",
  src: [
    { path: "./fonts/SpaceGrotesk-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/SpaceGrotesk-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/SpaceGrotesk-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/SpaceGrotesk-700.woff2", weight: "700", style: "normal" },
  ],
});

const jetbrainsMono = localFont({
  variable: "--font-jetmono",
  display: "swap",
  src: [
    { path: "./fonts/JetBrainsMono-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/JetBrainsMono-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/JetBrainsMono-600.woff2", weight: "600", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "Sephiroth — Control Panel",
  description:
    "Sephiroth: a cosmic-grade control panel. Obsidian glass, electric cyan, platinum silver.",
  applicationName: "Sephiroth",
  icons: {
    icon: [{ url: "/sephiroth-logo.png", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png" }],
  },
  openGraph: {
    title: "Sephiroth — Control Panel",
    description: "A cosmic-grade control panel. Dark sci-fi luxury for server orbit control.",
    siteName: "Sephiroth",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#060b0f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${vazirmatn.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
