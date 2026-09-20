import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmForm } from "@/components/confirm-form";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { REMINDER_CHANNEL_LABELS, type ReminderChannel } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatDateTime, formatRelative } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { requireTenant } from "@/lib/tenant";
import {
  cancelReminderAction,
  completeReminderAction,
  snoozeReminderAction,
} from "@/server/reminder-actions";

export const metadata: Metadata = { title: "Follow-ups" };

export default async function RemindersPage() {
  const { session, profile } = await requireTenant();
  const now = new Date();

  const reminders = await prisma.reminder.findMany({
    where: { organizationId: session.organizationId },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    take: 200,
    include: {
      quotation: {
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          totalCents: true,
          currency: true,
          customer: { select: { name: true } },
        },
      },
    },
  });

  const overdue = reminders.filter((r) => r.status === "pending" && r.dueAt <= now);
  const upcoming = reminders.filter((r) => r.status === "pending" && r.dueAt > now);
  const closed = reminders.filter((r) => r.status !== "pending");

  const sections = [
    { key: "overdue", title: "Overdue", items: overdue, tone: "danger" as const },
    { key: "upcoming", title: "Upcoming", items: upcoming, tone: "brand" as const },
    { key: "closed", title: "Closed", items: closed, tone: "neutral" as const },
  ];

  return (
    <>
      <PageHeader
        title="Follow-ups"
        description="Quotations go quiet. These are the ones you said you would chase."
      />

      {reminders.length === 0 ? (
        <Card>
          <EmptyState
            title="No follow-ups scheduled"
            description="Open a quotation and schedule a follow-up — it will show up here and in your dashboard when it is due."
          />
        </Card>
      ) : null}

      {sections
        .filter((section) => section.items.length > 0)
        .map((section) => (
          <Card key={section.key}>
            <CardHeader title={`${section.title} (${section.items.length})`} />
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
                        {formatDateTime(reminder.dueAt, profile.locale)}
                        {reminder.status === "pending"
                          ? ` · ${formatRelative(reminder.dueAt, profile.locale, now)}`
                          : null}{" "}
                        ·{" "}
                        {formatMoney(
                          reminder.quotation.totalCents,
                          reminder.quotation.currency,
                          profile.locale,
                        )}{" "}
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
          </Card>
        ))}
    </>
  );
}
