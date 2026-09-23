import Link from "next/link";

/**
 * The centred card used by the pages that hang off an emailed link:
 * confirmation, password reset and invitations.
 *
 * These deliberately live outside the `(auth)` route group. That layout sends
 * a signed-in visitor to the dashboard, which would make a confirmation link
 * impossible to follow for the very person who asked for it — the one already
 * signed in.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col">
      <header className="px-5 py-5 sm:px-8">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          QuoteFlow<span className="text-[var(--color-brand)]"> AI</span>
        </Link>
      </header>
      <div className="flex flex-1 items-center justify-center px-5 pb-16 sm:px-8">
        <div className="w-full max-w-md">
          <div className="card p-6 sm:p-8">{children}</div>
        </div>
      </div>
    </main>
  );
}
