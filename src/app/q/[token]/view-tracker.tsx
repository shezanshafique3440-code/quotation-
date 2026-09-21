"use client";

import { useEffect } from "react";

/**
 * Reports a view once the page has rendered in a real browser.
 *
 * Deliberately client-side: server-rendering the page also happens for link
 * previews and crawlers, and counting those as customer views would put a
 * fabricated "opened" event in the owner's timeline. Failures are swallowed —
 * analytics must never break the page the customer came to read.
 */
export function ViewTracker({ token }: { token: string }) {
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/q/${encodeURIComponent(token)}/view`, {
      method: "POST",
      signal: controller.signal,
      keepalive: true,
    }).catch(() => undefined);
    return () => controller.abort();
  }, [token]);

  return null;
}
