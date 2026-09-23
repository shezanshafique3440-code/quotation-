import Link from "next/link";
import { redirect } from "next/navigation";
import { DesktopNav, MobileNav, type NavItem } from "@/components/app-nav";
import { SubmitButton } from "@/components/submit-button";
import { VerifyBanner } from "@/components/verify-banner";
import { prisma } from "@/lib/db";
import { isEmailConfigured } from "@/lib/env";
import { PLAN_LABELS } from "@/lib/plans";
import { getSession } from "@/lib/session";
import { signOutAction } from "@/server/auth-actions";

/**
 * Loading skeletons live on individual leaf routes, never on this group and
 * never on a segment that has dynamic children.
 *
 * A `loading.tsx` makes Next stream the response, which commits the HTTP
 * status before the page component runs — so a `notFound()` raised by a
 * tenant-ownership check would render the 404 page with a 200 status. The
 * boundary also covers every nested segment, so a skeleton on `/quotations`
 * would silently do the same to `/quotations/[id]`. Routes that can 404
 * (`quotations`, `customers`, `inquiries` and their children) are therefore
 * left un-streamed; the heavier leaf routes keep their skeletons.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const [newInquiries, dueReminders, account] = await Promise.all([
    prisma.inquiry.count({ where: { organizationId: session.organizationId, status: "new" } }),
    prisma.reminder.count({
      where: {
        organizationId: session.organizationId,
        status: "pending",
        dueAt: { lte: new Date() },
      },
    }),
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { emailVerifiedAt: true },
    }),
  ]);

  // Only ask for confirmation where confirmation is actually possible: with no
  // provider there is no link to send, and a banner urging an impossible
  // action would just be noise.
  const needsVerification = isEmailConfigured() && !account?.emailVerifiedAt;

  const items: NavItem[] = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/inquiries", label: "Inquiries", badge: newInquiries },
    { href: "/quotations", label: "Quotations" },
    { href: "/customers", label: "Customers" },
    { href: "/products", label: "Catalog" },
    { href: "/templates", label: "Templates" },
    { href: "/reminders", label: "Follow-ups", badge: dueReminders },
    { href: "/analytics", label: "Analytics" },
    { href: "/settings/business", label: "Business profile" },
    { href: "/settings/team", label: "Teammates" },
    { href: "/settings/billing", label: "Plan & usage" },
    { href: "/settings/audit", label: "Audit log" },
  ];

  const planLabel = PLAN_LABELS[session.organization.plan === "pro" ? "pro" : "free"];

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="hidden border-r border-[var(--color-line)] bg-[var(--color-surface)] lg:flex lg:flex-col">
        <div className="px-5 py-5">
          <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
            QuoteFlow<span className="text-[var(--color-brand)]"> AI</span>
          </Link>
          <p className="mt-2 truncate text-xs text-[var(--color-ink-subtle)]">
            {session.organization.name}
          </p>
        </div>
        <div className="flex-1 px-3">
          <DesktopNav items={items} />
        </div>
        <div className="border-t border-[var(--color-line)] p-4">
          <p className="truncate text-sm font-medium">{session.user.name}</p>
          <p className="truncate text-xs text-[var(--color-ink-subtle)]">{session.user.email}</p>
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">{planLabel} plan</p>
          <form action={signOutAction} className="mt-3">
            <SubmitButton variant="secondary" className="w-full" pendingLabel="Signing out…">
              Sign out
            </SubmitButton>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="relative flex items-center justify-between gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 lg:hidden">
          <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
            QuoteFlow<span className="text-[var(--color-brand)]"> AI</span>
          </Link>
          <div className="flex items-center gap-2">
            <form action={signOutAction}>
              <SubmitButton variant="ghost" pendingLabel="…">
                Sign out
              </SubmitButton>
            </form>
            <MobileNav items={items} />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-5xl space-y-6">
            {needsVerification ? <VerifyBanner email={session.user.email} /> : null}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
