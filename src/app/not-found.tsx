import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-16">
      <div className="card max-w-md p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-subtle)]">
          404
        </p>
        <h1 className="mt-2 text-lg font-semibold">We could not find that page</h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          The link may be out of date, or the item may belong to a different workspace.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/dashboard" className="btn btn-primary">
            Go to dashboard
          </Link>
          <Link href="/" className="btn btn-secondary">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
