/**
 * Timezone-aware date arithmetic, using only `Intl` — no date library.
 *
 * Everything is stored in UTC. A business in Auckland and one in Vancouver
 * must both see "expires 1 April" mean the end of *their* 1 April, so every
 * boundary is computed in the organization's IANA zone.
 */

export const DEFAULT_TIMEZONE = "UTC";

let supported: Set<string> | null = null;

function supportedZones(): Set<string> | null {
  if (supported) return supported;
  const withValues = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  if (typeof withValues.supportedValuesOf !== "function") return null;
  try {
    supported = new Set(withValues.supportedValuesOf("timeZone"));
    return supported;
  } catch {
    return null;
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== "string") return false;

  const known = supportedZones();
  if (known?.has(timeZone)) return true;

  // Older runtimes lack supportedValuesOf, and the list omits some valid
  // aliases, so fall back to asking the formatter directly.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Every zone the runtime knows, for the settings picker. */
export function listTimeZones(): string[] {
  const known = supportedZones();
  return known ? [...known].sort() : [DEFAULT_TIMEZONE];
}

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const PART_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function partFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = PART_FORMATTERS.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    PART_FORMATTERS.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock fields of `date` as seen in `timeZone`. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const map: Record<string, string> = {};
  for (const part of partFormatter(zone).formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    // `h23` still reports midnight as 24 on some ICU builds.
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Offset of `timeZone` from UTC at the instant `date`, in milliseconds. */
export function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const wallClockAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Discard sub-second precision on both sides so the difference is exact.
  return wallClockAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The instant at which the given wall-clock time occurs in `timeZone`.
 *
 * Two passes: guess using the offset at the naive instant, then re-measure at
 * the guessed instant. That converges for every real zone, including the
 * hours around a DST transition.
 */
export function fromZonedParts(parts: ZonedParts, timeZone: string): Date {
  const naive = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  let instant = naive - zoneOffsetMs(new Date(naive), timeZone);
  instant = naive - zoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

export function startOfDayInZone(date: Date, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  return fromZonedParts({ ...p, hour: 0, minute: 0, second: 0 }, timeZone);
}

/**
 * The last instant of the local day. A quotation "valid until 1 April" stays
 * valid through all of 1 April in the business's own zone.
 */
export function endOfDayInZone(date: Date, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  const startOfNextDay = fromZonedParts(
    { year: p.year, month: p.month, day: p.day + 1, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
  return new Date(startOfNextDay.getTime() - 1);
}

export function addDaysInZone(date: Date, days: number, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  return fromZonedParts({ ...p, day: p.day + days }, timeZone);
}

/** `YYYY-MM-DD` as seen in the zone — the value an `<input type="date">` wants. */
export function toDateInputInZone(date: Date | null | undefined, timeZone: string): string {
  if (!date) return "";
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** `YYYY-MM-DDTHH:mm` as seen in the zone, for `<input type="datetime-local">`. */
export function toDateTimeInputInZone(date: Date | null | undefined, timeZone: string): string {
  if (!date) return "";
  const p = zonedParts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Parse `YYYY-MM-DD` as the *end* of that day in the zone (expiry semantics). */
export function parseDateEndOfDay(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match as unknown as [string, string, string, string];
  const startOfNextDay = fromZonedParts(
    { year: Number(y), month: Number(m), day: Number(d) + 1, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
  if (Number.isNaN(startOfNextDay.getTime())) return null;
  return new Date(startOfNextDay.getTime() - 1);
}

/** Parse `YYYY-MM-DDTHH:mm` as that wall-clock time in the zone. */
export function parseDateTimeInZone(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match as unknown as [string, string, string, string, string, string];
  const date = fromZonedParts(
    {
      year: Number(y),
      month: Number(mo),
      day: Number(d),
      hour: Number(h),
      minute: Number(mi),
      second: 0,
    },
    timeZone,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Short zone label for the UI, e.g. "GMT+2". */
export function zoneAbbreviation(timeZone: string, date: Date = new Date()): string {
  if (!isValidTimeZone(timeZone)) return "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(date);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}
