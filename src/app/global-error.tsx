"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary: replaces the whole document, so it ships its own
 * `<html>` and inline styles rather than relying on the app stylesheet.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error("[app] global error", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          background: "#f8f8fb",
          color: "#1b1c22",
        }}
      >
        <main style={{ maxWidth: "28rem", padding: "2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.125rem", margin: 0 }}>QuoteFlow is temporarily unavailable</h1>
          <p style={{ fontSize: "0.875rem", color: "#5b5d6b", marginTop: "0.5rem" }}>
            Please try again in a moment. Nothing was saved or changed by the failed request.
          </p>
          {error.digest ? (
            <p style={{ fontSize: "0.75rem", color: "#8b8d99", marginTop: "0.75rem" }}>
              Reference: {error.digest}
            </p>
          ) : null}
          {/* A plain anchor on purpose: this boundary replaces the document,
              so the router that <Link> depends on is not mounted. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{
              display: "inline-block",
              marginTop: "1.25rem",
              padding: "0.55rem 0.95rem",
              borderRadius: "0.625rem",
              background: "#4b3ddb",
              color: "#fff",
              textDecoration: "none",
              fontSize: "0.875rem",
            }}
          >
            Reload
          </a>
        </main>
      </body>
    </html>
  );
}
