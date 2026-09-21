import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { auditLog, ACTIVITY_CATEGORIES, type ActivityCategory } from "@/lib/activity";
import { requireTenant } from "@/lib/tenant";

export const metadata: Metadata = { title: "Audit log" };

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  quotation: "Quotations",
  customer: "Customers",
  security: "Security",
  billing: "Billing",
  settings: "Settings",
};

function isCategory(value: string | undefined): value is ActivityCategory {
  return value !== undefined && (ACTIVITY_CATEGORIES as readonly string[]).includes(value);
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const { session, fmt } = await requireTenant();
  const filter = isCategory(category) ? category : undefined;

  const entries = await auditLog(session.organizationId, {
    ...(filter ? { category: filter } : {}),
    take: 200,
  });

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of everything that happened in this workspace. Times shown in your business timezone."
      />

      <nav className="flex flex-wrap gap-2" aria-label="Filter by category">
        <Link
          href="/settings/audit"
          className={`btn ${filter === undefined ? "btn-primary" : "btn-secondary"}`}
        >
          Everything
        </Link>
        {ACTIVITY_CATEGORIES.map((value) => (
          <Link
            key={value}
            href={`/settings/audit?category=${value}`}
            className={`btn ${filter === value ? "btn-primary" : "btn-secondary"}`}
          >
            {CATEGORY_LABELS[value]}
          </Link>
        ))}
      </nav>

      <Card>
        <CardHeader
          title={filter ? CATEGORY_LABELS[filter] : "All activity"}
          description={`${entries.length} event${entries.length === 1 ? "" : "s"} shown, newest first`}
        />
        {entries.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            description="Sign-ins, quotation changes, customer responses and plan changes all appear here as they happen."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-2xl text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)] text-left text-xs uppercase tracking-wide text-[var(--color-ink-subtle)]">
                  <th scope="col" className="px-5 py-2 font-medium">When</th>
                  <th scope="col" className="px-3 py-2 font-medium">Event</th>
                  <th scope="col" className="px-3 py-2 font-medium">Actor</th>
                  <th scope="col" className="px-5 py-2 font-medium">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="whitespace-nowrap px-5 py-2.5 text-xs text-[var(--color-ink-muted)]">
                      <time dateTime={entry.createdAt.toISOString()}>
                        {fmt.dateTime(entry.createdAt)}
                      </time>
                    </td>
                    <td className="px-3 py-2.5">{entry.summary}</td>
                    <td className="px-3 py-2.5 text-xs text-[var(--color-ink-muted)]">
                      {entry.actorLabel}
                    </td>
                    <td className="px-5 py-2.5 font-mono text-xs text-[var(--color-ink-subtle)]">
                      {entry.kind}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-[var(--color-ink-subtle)]">
        Client IP addresses are stored as a keyed one-way hash, never in the clear. Rows are only
        ever inserted — the application has no code path that edits or deletes one.
      </p>
    </>
  );
}
