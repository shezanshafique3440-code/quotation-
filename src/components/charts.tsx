import type { ReactNode } from "react";

/**
 * Chart palettes.
 *
 * Both were checked with the data-viz validator against this app's real
 * surfaces (#ffffff light, #141820 dark):
 *
 *  - FUNNEL_STEPS is a single-hue ordinal ramp (blue), monotone in lightness,
 *    light end clearing 2:1 on each surface — the right encoding for ordered
 *    stages of one measure.
 *  - OUTCOME_COLORS is the reserved status palette. Worst adjacent CVD ΔE is
 *    11.3 and normal-vision ΔE 27.6, comfortably clear of the floors. Amber
 *    sits below 3:1 on a white surface by design, so every chart that uses it
 *    also ships a labelled legend and the table view below it — identity is
 *    never carried by colour alone.
 */
const FUNNEL_STEPS = {
  light: ["#86b6ef", "#3987e5", "#1c5cab"],
  dark: ["#9ec5f4", "#3987e5", "#184f95"],
} as const;

export const OUTCOME_COLORS = {
  accepted: "#0ca30c",
  expired: "#fab219",
  rejected: "#d03b3b",
} as const;

export type OutcomeKey = keyof typeof OUTCOME_COLORS;

export const OUTCOME_LABELS: Record<OutcomeKey, string> = {
  accepted: "Accepted",
  expired: "Expired",
  rejected: "Declined",
};

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

export interface FunnelDatum {
  label: string;
  count: number;
  conversionFromPrevious: number | null;
}

/**
 * Ordered stages of one measure, drawn as plain horizontal bars.
 *
 * Deliberately not a tapering funnel shape: a trapezoid encodes the value in
 * an area the eye cannot compare, while bar length is directly readable.
 */
export function FunnelChart({ stages }: { stages: FunnelDatum[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));

  return (
    <div>
      <ol className="space-y-3">
        {stages.map((stage, index) => {
          const width = (stage.count / max) * 100;
          return (
            <li key={stage.label}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{stage.label}</span>
                <span className="tabular-nums text-[var(--color-ink-muted)]">
                  {stage.count}
                  {stage.conversionFromPrevious !== null ? (
                    <span className="ml-2 text-xs">
                      {percent(stage.conversionFromPrevious)} of previous
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{
                    width: `${Math.max(width, stage.count > 0 ? 2 : 0)}%`,
                    background: `var(--funnel-${index})`,
                  }}
                  title={`${stage.label}: ${stage.count}`}
                />
              </div>
            </li>
          );
        })}
      </ol>
      <FunnelPaletteVars />
    </div>
  );
}

/**
 * The ordinal ramp as custom properties, with a dark-mode set chosen for the
 * dark surface rather than derived by flipping the light one.
 */
function FunnelPaletteVars() {
  const css = `
    .analytics-root {
      --funnel-0: ${FUNNEL_STEPS.light[0]};
      --funnel-1: ${FUNNEL_STEPS.light[1]};
      --funnel-2: ${FUNNEL_STEPS.light[2]};
    }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) .analytics-root {
        --funnel-0: ${FUNNEL_STEPS.dark[0]};
        --funnel-1: ${FUNNEL_STEPS.dark[1]};
        --funnel-2: ${FUNNEL_STEPS.dark[2]};
      }
    }
    :root[data-theme="dark"] .analytics-root {
      --funnel-0: ${FUNNEL_STEPS.dark[0]};
      --funnel-1: ${FUNNEL_STEPS.dark[1]};
      --funnel-2: ${FUNNEL_STEPS.dark[2]};
    }
  `;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

export interface MonthlyDatum {
  month: string;
  sent: number;
  accepted: number;
  rejected: number;
  expired: number;
}

function monthLabel(month: string): string {
  const [year, index] = month.split("-");
  const date = new Date(Date.UTC(Number(year), Number(index) - 1, 1));
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
  } catch {
    return month;
  }
}

/**
 * Outcomes per month, stacked inside a track whose full height is everything
 * sent that month. The unfilled remainder is "still open" — drawn as absence
 * rather than as a fourth low-chroma series, which would have read as grey and
 * competed with the three real outcomes.
 */
export function MonthlyOutcomes({ data }: { data: MonthlyDatum[] }) {
  const max = Math.max(1, ...data.map((d) => d.sent));

  return (
    <div className="space-y-4">
      {/* items-stretch + flex-1 on the plot area give each column a definite
          height, which the percentage-height bars resolve against. */}
      <div
        className="flex h-44 items-stretch gap-2"
        role="img"
        aria-label="Quotation outcomes by month. The same figures are in the table below."
      >
        {data.map((month) => {
          const segments: { key: OutcomeKey; value: number }[] = [
            { key: "accepted", value: month.accepted },
            { key: "rejected", value: month.rejected },
            { key: "expired", value: month.expired },
          ];
          const trackHeight = (month.sent / max) * 100;

          return (
            <div key={month.month} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1.5">
              <div className="flex w-full flex-1 items-end justify-center">
                <div
                  className="flex w-full max-w-10 flex-col-reverse justify-start overflow-hidden rounded-t-md bg-[var(--color-surface-2)]"
                  style={{ height: `${Math.max(trackHeight, month.sent > 0 ? 4 : 2)}%` }}
                  title={`${monthLabel(month.month)}: ${month.sent} sent, ${month.accepted} accepted, ${month.rejected} declined, ${month.expired} expired`}
                >
                  {segments
                    .filter((segment) => segment.value > 0)
                    .map((segment) => (
                      <div
                        key={segment.key}
                        // A 2px surface gap keeps adjacent fills from fusing.
                        className="w-full border-b-2 border-[var(--color-surface)] first:border-b-0"
                        style={{
                          height: `${(segment.value / Math.max(month.sent, 1)) * 100}%`,
                          background: OUTCOME_COLORS[segment.key],
                        }}
                        title={`${OUTCOME_LABELS[segment.key]}: ${segment.value}`}
                      />
                    ))}
                </div>
              </div>
              <span className="text-xs text-[var(--color-ink-subtle)]">
                {monthLabel(month.month)}
              </span>
            </div>
          );
        })}
      </div>

      <Legend />

      {/* The table view the relief rule requires, and the accessible fallback. */}
      <details className="text-sm">
        <summary className="cursor-pointer text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
          View as a table
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-xs uppercase tracking-wide text-[var(--color-ink-subtle)]">
                <th scope="col" className="py-2 font-medium">Month</th>
                <th scope="col" className="py-2 text-right font-medium">Sent</th>
                <th scope="col" className="py-2 text-right font-medium">Accepted</th>
                <th scope="col" className="py-2 text-right font-medium">Declined</th>
                <th scope="col" className="py-2 text-right font-medium">Expired</th>
                <th scope="col" className="py-2 text-right font-medium">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)] tabular-nums">
              {data.map((month) => (
                <tr key={month.month}>
                  <th scope="row" className="py-2 text-left font-normal">
                    {monthLabel(month.month)}
                  </th>
                  <td className="py-2 text-right">{month.sent}</td>
                  <td className="py-2 text-right">{month.accepted}</td>
                  <td className="py-2 text-right">{month.rejected}</td>
                  <td className="py-2 text-right">{month.expired}</td>
                  <td className="py-2 text-right">
                    {Math.max(0, month.sent - month.accepted - month.rejected - month.expired)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-[var(--color-ink-muted)]">
      {(Object.keys(OUTCOME_COLORS) as OutcomeKey[]).map((key) => (
        <li key={key} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 rounded-[3px]"
            style={{ background: OUTCOME_COLORS[key] }}
          />
          {OUTCOME_LABELS[key]}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-2.5 rounded-[3px] bg-[var(--color-surface-2)]" />
        Still open
      </li>
    </ul>
  );
}

/** A single headline number, with its supporting detail underneath. */
export function MetricTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: ReactNode;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-subtle)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {detail ? <div className="mt-1 text-xs text-[var(--color-ink-muted)]">{detail}</div> : null}
    </div>
  );
}
