import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmForm } from "@/components/confirm-form";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { REMINDER_CHANNEL_LABELS, type ReminderChannel } from "@/lib/constants";
import { requireTenant } from "@/lib/tenant";
import { getReminderGroups, type ReminderGroup } from "@/lib/reminder-list";
import {
  cancelReminderAction,
  completeReminderAction,
  snoozeReminderAction,
} from "@/server/reminder-actions";

export const metadata: Metadata = { title: "Follow-ups" };

export default async function RemindersPage({
  searchParams,
}: {
  searchParams: Promise<{ overduePage?: string; upcomingPage?: string; closedPage?: string }>;
}) {
  const query = await searchParams;
  const { session, fmt } = await requireTenant();
  const now = new Date();
  const groups = await getReminderGroups(session.organizationId, {
    now,
    pages: { overdue: query.overduePage, upcoming: query.upcomingPage, closed: query.closedPage },
  });
  const sections = [
    { key: "overdue" as const, title: "Overdue", ...groups.overdue },
    { key: "upcoming" as const, title: "Upcoming", ...groups.upcoming },
    { key: "closed" as const, title: "Closed", ...groups.closed },
  ];
  const total = sections.reduce((count, section) => count + section.total, 0);
  const pageHref = (key: ReminderGroup, page: number) => {
    const params = new URLSearchParams();
    for (const section of sections) {
      const value = section.key === key ? page : section.page;
      if (value > 1) params.set(`${section.key}Page`, String(value));
    }
    const suffix = params.toString();
    return suffix ? `/reminders?${suffix}` : "/reminders";
  };

  return (
    <>
      <PageHeader
        title="Follow-ups"
        description="Quotations go quiet. These are the ones you said you would chase."
      />

      {total === 0 ? (
        <Card>
          <EmptyState
            title="No follow-ups scheduled"
            description="Open a quotation and schedule a follow-up — it will show up here and in your dashboard when it is due."
          />
        </Card>
      ) : null}

      {sections
        .filter((section) => section.total > 0)
        .map((section) => (
          <Card key={section.key}>
            <CardHeader title={`${section.title} (${section.total})`} />
            <ul className="divide-y divide-[var(--color-line)]">
              {section.items.map((reminder) => (
                <li key={reminder.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/quotations/${reminder.quotation.id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {reminder.quotation.customer.name} · {reminder.quotation.number}
                      </Link>
                      <p className="truncate text-sm text-[var(--color-ink-muted)]">
                        {reminder.note?.trim() ||
                          `Follow up by ${REMINDER_CHANNEL_LABELS[reminder.channel as ReminderChannel] ?? reminder.channel}`}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--color-ink-subtle)]">
                        {fmt.dateTime(reminder.dueAt)}
                        {reminder.status === "pending"
                          ? ` · ${fmt.relative(reminder.dueAt, now)}`
                          : null}{" "}
                        ·{" "}
                        {fmt.money(reminder.quotation.totalCents, reminder.quotation.currency)}{" "}
                        · {reminder.quotation.status}
                      </p>
                    </div>

                    {reminder.status === "pending" ? (
                      <div className="flex flex-wrap gap-2">
                        <ConfirmForm
                          action={completeReminderAction}
                          fields={{ id: reminder.id }}
                          label="Done"
                          pendingLabel="…"
                          showResult={false}
                        />
                        <ConfirmForm
                          action={snoozeReminderAction}
                          fields={{ id: reminder.id, days: "3" }}
                          label="Snooze 3 days"
                          pendingLabel="…"
                          variant="ghost"
                          showResult={false}
                        />
                        <ConfirmForm
                          action={cancelReminderAction}
                          fields={{ id: reminder.id }}
                          label="Cancel"
                          pendingLabel="…"
                          variant="ghost"
                          showResult={false}
                        />
                      </div>
                    ) : (
                      <Badge tone={reminder.status === "done" ? "positive" : "neutral"}>
                        {reminder.status}
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {section.totalPages > 1 ? (
              <nav
                aria-label={`${section.title} follow-up pages`}
                className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] px-5 py-3 text-sm"
              >
                <p className="text-[var(--color-ink-muted)]">
                  Page {section.page} of {section.totalPages}
                </p>
                <div className="flex gap-2">
                  {section.page > 1 ? (
                    <Link className="btn btn-secondary" href={pageHref(section.key, section.page - 1)}>
                      Previous
                    </Link>
                  ) : null}
                  {section.page < section.totalPages ? (
                    <Link className="btn btn-secondary" href={pageHref(section.key, section.page + 1)}>
                      Next
                    </Link>
                  ) : null}
                </div>
              </nav>
            ) : null}
          </Card>
        ))}
    </>
  );
}
