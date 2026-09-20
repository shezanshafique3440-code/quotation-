export const PLANS = ["free", "pro"] as const;
export type Plan = (typeof PLANS)[number];

export function isPlan(value: string): value is Plan {
  return (PLANS as readonly string[]).includes(value);
}

export interface PlanLimits {
  /** AI drafts generated per calendar month. `null` means unmetered. */
  aiDraftsPerMonth: number | null;
  /** Quotations created per calendar month. `null` means unmetered. */
  quotationsPerMonth: number | null;
  /** Active catalog products. `null` means unmetered. */
  products: number | null;
  /** Team members in the organization. `null` means unmetered. */
  teamMembers: number | null;
  customBranding: boolean;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    aiDraftsPerMonth: 10,
    quotationsPerMonth: 20,
    products: 25,
    teamMembers: 1,
    customBranding: false,
  },
  pro: {
    aiDraftsPerMonth: null,
    quotationsPerMonth: null,
    products: null,
    teamMembers: 10,
    customBranding: true,
  },
};

export const PLAN_LABELS: Record<Plan, string> = {
  free: "Free",
  pro: "Pro",
};

export function limitsFor(plan: string): PlanLimits {
  return PLAN_LIMITS[isPlan(plan) ? plan : "free"];
}

/** Inclusive check: `used` is the count *before* the action being attempted. */
export function isWithinLimit(used: number, limit: number | null): boolean {
  return limit === null || used < limit;
}

/** First instant of the current UTC calendar month — the metering window. */
export function currentPeriodStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

export function currentPeriodEnd(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}
