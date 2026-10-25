import type { Metadata, Viewport } from "next";
import { Vazirmatn, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const vazirmatn = Vazirmatn({
  variable: "--font-vazir",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetmono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
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
