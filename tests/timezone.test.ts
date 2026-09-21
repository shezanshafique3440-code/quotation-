import { describe, expect, it } from "vitest";
import {
  addDaysInZone,
  endOfDayInZone,
  fromZonedParts,
  isValidTimeZone,
  listTimeZones,
  parseDateEndOfDay,
  parseDateTimeInZone,
  startOfDayInZone,
  toDateInputInZone,
  toDateTimeInputInZone,
  zonedParts,
  zoneOffsetMs,
} from "@/lib/timezone";

const HOUR = 3_600_000;

describe("isValidTimeZone", () => {
  it("accepts real IANA zones and rejects invented ones", () => {
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("Not A Zone")).toBe(false);
  });

  it("returns a usable list for the settings picker", () => {
    const zones = listTimeZones();
    expect(zones.length).toBeGreaterThan(50);
    expect(zones).toContain("Europe/London");
  });
});

describe("zoneOffsetMs", () => {
  it("tracks DST rather than assuming a fixed offset", () => {
    const summer = zoneOffsetMs(new Date("2026-07-15T12:00:00Z"), "Europe/Berlin");
    const winter = zoneOffsetMs(new Date("2026-01-15T12:00:00Z"), "Europe/Berlin");
    expect(summer / HOUR).toBe(2);
    expect(winter / HOUR).toBe(1);
  });

  it("handles southern-hemisphere DST and half-hour offsets", () => {
    expect(zoneOffsetMs(new Date("2026-01-15T00:00:00Z"), "Pacific/Auckland") / HOUR).toBe(13);
    expect(zoneOffsetMs(new Date("2026-07-15T00:00:00Z"), "Pacific/Auckland") / HOUR).toBe(12);
    expect(zoneOffsetMs(new Date("2026-06-01T00:00:00Z"), "Asia/Kolkata") / HOUR).toBe(5.5);
    expect(zoneOffsetMs(new Date("2026-06-01T00:00:00Z"), "America/Los_Angeles") / HOUR).toBe(-7);
  });

  it("falls back to UTC for an unusable zone instead of throwing", () => {
    expect(zoneOffsetMs(new Date("2026-06-01T00:00:00Z"), "Mars/Olympus")).toBe(0);
  });
});

describe("end of day", () => {
  it("is the last instant of the local day, not of UTC", () => {
    const instant = new Date("2026-04-01T10:00:00Z");
    expect(endOfDayInZone(instant, "Europe/Berlin").toISOString()).toBe("2026-04-01T21:59:59.999Z");
    expect(endOfDayInZone(instant, "Pacific/Auckland").toISOString()).toBe(
      "2026-04-01T10:59:59.999Z",
    );
    expect(endOfDayInZone(instant, "UTC").toISOString()).toBe("2026-04-01T23:59:59.999Z");
  });

  it("gives an Auckland business a later deadline than a Los Angeles one on paper", () => {
    const auckland = endOfDayInZone(new Date("2026-04-01T00:00:00Z"), "Pacific/Auckland");
    const la = endOfDayInZone(new Date("2026-04-01T20:00:00Z"), "America/Los_Angeles");
    // Same calendar date, but LA's day ends much later in absolute time.
    expect(la.getTime()).toBeGreaterThan(auckland.getTime());
  });
});

describe("start of day and day arithmetic across DST", () => {
  it("finds local midnight on a spring-forward day", () => {
    expect(startOfDayInZone(new Date("2026-03-29T12:00:00Z"), "Europe/Berlin").toISOString()).toBe(
      "2026-03-28T23:00:00.000Z",
    );
  });

  it("adds a calendar day, not exactly 24 hours, across a DST change", () => {
    const before = new Date("2026-03-28T23:00:00Z"); // 2026-03-29 00:00 CET
    const after = addDaysInZone(before, 1, "Europe/Berlin");
    // 2026-03-30 00:00 CEST — 23 real hours later, one calendar day.
    expect(after.toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(after.getTime() - before.getTime()).toBe(23 * HOUR);
  });

  it("supports negative day offsets", () => {
    expect(
      addDaysInZone(new Date("2026-04-01T12:00:00Z"), -2, "UTC").toISOString(),
    ).toBe("2026-03-30T12:00:00.000Z");
  });
});

describe("parsing form values in a zone", () => {
  it("reads a date input as the end of that day", () => {
    expect(parseDateEndOfDay("2026-04-01", "America/Los_Angeles")?.toISOString()).toBe(
      "2026-04-02T06:59:59.999Z",
    );
    expect(parseDateEndOfDay("2026-04-01", "UTC")?.toISOString()).toBe("2026-04-01T23:59:59.999Z");
  });

  it("reads a datetime-local input as that wall-clock time", () => {
    expect(parseDateTimeInZone("2026-04-01T09:00", "Asia/Tokyo")?.toISOString()).toBe(
      "2026-04-01T00:00:00.000Z",
    );
    expect(parseDateTimeInZone("2026-04-01 09:00", "UTC")?.toISOString()).toBe(
      "2026-04-01T09:00:00.000Z",
    );
  });

  it("returns null for junk instead of an Invalid Date", () => {
    expect(parseDateEndOfDay("not-a-date", "UTC")).toBeNull();
    expect(parseDateEndOfDay("2026-4-1", "UTC")).toBeNull();
    expect(parseDateTimeInZone("2026-04-01", "UTC")).toBeNull();
  });
});

describe("input values", () => {
  it("renders the local calendar date, which can differ from the UTC date", () => {
    const instant = new Date("2026-04-01T23:30:00Z");
    expect(toDateInputInZone(instant, "Pacific/Auckland")).toBe("2026-04-02");
    expect(toDateInputInZone(instant, "UTC")).toBe("2026-04-01");
    expect(toDateInputInZone(instant, "America/Los_Angeles")).toBe("2026-04-01");
  });

  it("renders a padded datetime-local value", () => {
    expect(toDateTimeInputInZone(new Date("2026-04-05T07:05:00Z"), "UTC")).toBe("2026-04-05T07:05");
  });

  it("renders an empty string for a missing date", () => {
    expect(toDateInputInZone(null, "UTC")).toBe("");
    expect(toDateTimeInputInZone(undefined, "UTC")).toBe("");
  });
});

describe("round trip", () => {
  it("parts → instant → parts is stable across zones and seasons", () => {
    const cases = [
      ["Europe/Berlin", "2026-01-15T08:30:00Z"],
      ["Europe/Berlin", "2026-07-15T08:30:00Z"],
      ["Pacific/Auckland", "2026-01-15T08:30:00Z"],
      ["Asia/Kolkata", "2026-07-15T08:30:00Z"],
      ["America/Sao_Paulo", "2026-02-15T08:30:00Z"],
    ] as const;

    for (const [zone, iso] of cases) {
      const parts = zonedParts(new Date(iso), zone);
      const instant = fromZonedParts(parts, zone);
      expect(zonedParts(instant, zone)).toEqual(parts);
    }
  });
});
