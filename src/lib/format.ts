export function formatDate(date: Date | null | undefined, locale = "en-US"): string {
  if (!date) return "—";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function formatDateTime(date: Date | null | undefined, locale = "en-US"): string {
  if (!date) return "—";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
  } catch {
    return date.toISOString();
  }
}

/** "in 3 days" / "2 days ago", used for follow-up due dates. */
export function formatRelative(date: Date, locale = "en-US", now: Date = new Date()): string {
  const diffMs = date.getTime() - now.getTime();
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];

  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    for (const [unit, ms] of units) {
      const value = Math.trunc(diffMs / ms);
      if (Math.abs(diffMs) >= ms || unit === "minute") return rtf.format(value, unit);
    }
    return rtf.format(0, "minute");
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Value for <input type="date">, in the browser-expected YYYY-MM-DD form. */
export function toDateInput(date: Date | null | undefined): string {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

export function toDateTimeInput(date: Date | null | undefined): string {
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function bpToInput(bp: number): string {
  return String(bp / 100);
}
