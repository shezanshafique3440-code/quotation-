import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { getEnv } from "@/lib/env";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  // Absolute URLs for canonicals, Open Graph and the sitemap.
  metadataBase: new URL(getEnv().APP_URL),
  title: {
    default: "QuoteFlow AI — quote-to-close for small businesses",
    template: "%s · QuoteFlow AI",
  },
  description:
    "Capture customer inquiries, draft quotations with AI, share a link your customer can accept or decline, and never lose a follow-up.",
  applicationName: "QuoteFlow AI",
  keywords: [
    "quotation software",
    "quote to cash",
    "small business quoting",
    "e-signature quotes",
    "WhatsApp quotations",
    "proposal software",
  ],
  openGraph: {
    siteName: "QuoteFlow AI",
    type: "website",
    locale: "en",
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0f16" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
