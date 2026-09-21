import Link from "next/link";

const NAV = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/security", label: "Security" },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-[var(--color-line)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            QuoteFlow<span className="text-[var(--color-brand)]"> AI</span>
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link href="/sign-in" className="btn btn-ghost">
              Sign in
            </Link>
            <Link href="/sign-up" className="btn btn-primary">
              Start free
            </Link>
          </div>
        </div>
      </header>

      {children}

      <footer className="border-t border-[var(--color-line)] px-5 py-10 sm:px-8">
        <div className="mx-auto max-w-6xl">
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              >
                {item.label}
              </Link>
            ))}
            <Link href="/sign-in" className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
              Sign in
            </Link>
          </nav>
          <p className="mt-4 max-w-2xl text-xs text-[var(--color-ink-subtle)]">
            QuoteFlow AI produces quotations, WhatsApp message drafts and follow-up reminders. It
            does not send messages on your behalf. AI drafting and card payments are optional
            integrations, configured per deployment.
          </p>
        </div>
      </footer>
    </div>
  );
}
