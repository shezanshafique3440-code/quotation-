import type { MetadataRoute } from "next";
import { getEnv } from "@/lib/env";

/**
 * Only the public marketing pages. Quotation share links and portal links are
 * private by URL and must never appear here — or anywhere a crawler looks.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = getEnv().APP_URL.replace(/\/$/, "");
  const lastModified = new Date();

  return [
    { url: `${base}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/features`, lastModified, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/pricing`, lastModified, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/security`, lastModified, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/sign-up`, lastModified, changeFrequency: "yearly", priority: 0.5 },
    { url: `${base}/sign-in`, lastModified, changeFrequency: "yearly", priority: 0.3 },
  ];
}
