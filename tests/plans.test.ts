import { describe, expect, it } from "vitest";
import {
  currentPeriodEnd,
  currentPeriodStart,
  isPlan,
  isWithinLimit,
  limitsFor,
  PLAN_LIMITS,
} from "@/lib/plans";

describe("plan limits", () => {
  it("treats an unknown plan string as free", () => {
    expect(limitsFor("enterprise")).toEqual(PLAN_LIMITS.free);
    expect(limitsFor("pro")).toEqual(PLAN_LIMITS.pro);
    expect(isPlan("pro")).toBe(true);
    expect(isPlan("gold")).toBe(false);
  });

  it("allows use strictly below the limit and blocks at it", () => {
    expect(isWithinLimit(0, 1)).toBe(true);
    expect(isWithinLimit(1, 1)).toBe(false);
    expect(isWithinLimit(9_999, null)).toBe(true);
  });
});

describe("metering window", () => {
  it("runs from the first instant of the UTC month to the first of the next", () => {
    const now = new Date("2026-03-17T23:30:00.000Z");
    expect(currentPeriodStart(now).toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(currentPeriodEnd(now).toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("rolls over the year in December", () => {
    const now = new Date("2026-12-31T12:00:00.000Z");
    expect(currentPeriodEnd(now).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});
