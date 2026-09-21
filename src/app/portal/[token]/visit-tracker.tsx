"use client";

import { useEffect } from "react";

/** Same reasoning as the quote page: only a real browser counts as a visit. */
export function VisitTracker({ token }: { token: string }) {
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/portal/${encodeURIComponent(token)}/visit`, {
      method: "POST",
      signal: controller.signal,
      keepalive: true,
    }).catch(() => undefined);
    return () => controller.abort();
  }, [token]);

  return null;
}
