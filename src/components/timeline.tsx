import type { TimelineEntry } from "@/lib/activity";
import type { Formatter } from "@/lib/format";

const DOT_TONE: Record<string, string> = {
  "quotation.accepted": "bg-[var(--color-positive)]",
  "quotation.signed": "bg-[var(--color-positive)]",
  "quotation.rejected": "bg-[var(--color-danger)]",
  "quotation.expired": "bg-[var(--color-warning)]",
  "quotation.viewed": "bg-[var(--color-brand)]",
  "quotation.sent": "bg-[var(--color-brand)]",
  "customer.portal_opened": "bg-[var(--color-brand)]",
  "security.sign_in_failed": "bg-[var(--color-danger)]",
};

const ACTOR_LABEL: Record<string, string> = {
  user: "Team",
  customer: "Customer",
  system: "Automatic",
  anonymous: "Anonymous",
};

export function Timeline({
  entries,
  fmt,
  emptyMessage = "Nothing has happened yet.",
}: {
  entries: TimelineEntry[];
  fmt: Formatter;
  emptyMessage?: string;
}) {
  if (entries.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-sm text-[var(--color-ink-muted)]">{emptyMessage}</p>
    );
  }

  return (
    <ol className="relative px-5 py-4">
      <span
        aria-hidden
        className="absolute left-[26px] top-6 bottom-6 w-px bg-[var(--color-line)]"
      />
      {entries.map((entry) => (
        <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
          <span
            aria-hidden
            className={`relative z-10 mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-[var(--color-surface)] ${
              DOT_TONE[entry.kind] ?? "bg-[var(--color-ink-subtle)]"
            }`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm">{entry.summary}</p>
            <p className="mt-0.5 text-xs text-[var(--color-ink-subtle)]">
              <time dateTime={entry.createdAt.toISOString()}>{fmt.dateTime(entry.createdAt)}</time>
              {" · "}
              {ACTOR_LABEL[entry.actorType] ?? entry.actorType}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
