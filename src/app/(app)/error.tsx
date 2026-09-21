"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Route-level error boundary for the signed-in app.
 *
 * Shows only that something failed plus the digest — the message itself may
 * contain internal detail and never reaches the browser in production.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] route error", error);
  }, [error]);

  return (
    <div className="card mx-auto max-w-lg p-8 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        This page could not be loaded. Your data is unaffected — nothing was saved or changed by
        the failed request.
      </p>
      {error.digest ? (
        <p className="mt-3 font-mono text-xs text-[var(--color-ink-subtle)]">
          Reference: {error.digest}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={reset} className="btn btn-primary">
          Try again
        </button>
        <Link href="/dashboard" className="btn btn-secondary">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
