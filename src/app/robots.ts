import type { MetadataRoute } from "next";
import { getEnv } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  const base = getEnv().APP_URL.replace(/\/$/, "");

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Everything tenant- or customer-specific stays out of the index.
        disallow: [
          "/q/",
          "/portal/",
          "/api/",
          "/dashboard",
          "/quotations",
          "/customers",
          "/inquiries",
          "/products",
          "/templates",
          "/reminders",
          "/analytics",
          "/settings",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
