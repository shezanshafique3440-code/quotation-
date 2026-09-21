import { minorUnitDigits } from "./currency";
import { formatMoney } from "./money";
import {
  DEFAULT_TIMEZONE,
  isValidTimeZone,
  toDateInputInZone,
  toDateTimeInputInZone,
  zoneAbbreviation,
} from "./timezone";

function safeZone(timeZone: string | undefined): string {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
}

export function formatDate(
  date: Date | null | undefined,
  locale = "en-US",
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (!date) return "—";
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeZone: safeZone(timeZone),
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function formatDateTime(
  date: Date | null | undefined,
  locale = "en-US",
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (!date) return "—";
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: safeZone(timeZone),
    }).format(date);
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

/** Value for <input type="date">, in the viewer's business timezone. */
export function toDateInput(
  date: Date | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  return toDateInputInZone(date, safeZone(timeZone));
}

export function toDateTimeInput(
  date: Date | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  return toDateTimeInputInZone(date, safeZone(timeZone));
}

/** Minor units back to the major-unit string a price input expects. */
export function centsToInput(cents: number, currency = "USD"): string {
  const digits = minorUnitDigits(currency);
  return (cents / 10 ** digits).toFixed(digits);
}

export function bpToInput(bp: number): string {
  return String(bp / 100);
}

export interface FormatContext {
  locale: string;
  timezone: string;
  currency: string;
}

/**
 * Bundles a tenant's locale, timezone and currency so page code cannot forget
 * to pass one of them and silently render a server-local date.
 */
export interface Formatter {
  date(value: Date | null | undefined): string;
  dateTime(value: Date | null | undefined): string;
  relative(value: Date, now?: Date): string;
  money(minorUnits: number, currency?: string): string;
  dateInput(value: Date | null | undefined): string;
  dateTimeInput(value: Date | null | undefined): string;
  zoneLabel(): string;
  readonly timezone: string;
  readonly locale: string;
}

export function createFormatter(context: FormatContext): Formatter {
  const timeZone = safeZone(context.timezone);
  const { locale, currency } = context;

  return {
    timezone: timeZone,
    locale,
    date: (value) => formatDate(value, locale, timeZone),
    dateTime: (value) => formatDateTime(value, locale, timeZone),
    relative: (value, now) => formatRelative(value, locale, now),
    money: (minorUnits, overrideCurrency) =>
      formatMoney(minorUnits, overrideCurrency ?? currency, locale),
    dateInput: (value) => toDateInput(value, timeZone),
    dateTimeInput: (value) => toDateTimeInput(value, timeZone),
    zoneLabel: () => zoneAbbreviation(timeZone),
  };
}
