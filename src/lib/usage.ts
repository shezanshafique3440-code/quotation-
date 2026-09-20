import { prisma } from "./db";
import { LimitExceededError } from "./errors";
import { currentPeriodEnd, currentPeriodStart, isWithinLimit, limitsFor, type PlanLimits } from "./plans";

export interface UsageSnapshot {
  plan: string;
  limits: PlanLimits;
  periodStart: Date;
  periodEnd: Date;
  aiDraftsUsed: number;
  quotationsUsed: number;
  productsUsed: number;
  teamMembers: number;
}

export async function getUsage(organizationId: string, now: Date = new Date()): Promise<UsageSnapshot> {
  const periodStart = currentPeriodStart(now);
  const periodEnd = currentPeriodEnd(now);

  const [organization, aiDraftsUsed, quotationsUsed, productsUsed, teamMembers] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { plan: true },
    }),
    prisma.usageEvent.count({
      where: { organizationId, kind: "ai_draft", createdAt: { gte: periodStart, lt: periodEnd } },
    }),
    prisma.quotation.count({
      where: { organizationId, createdAt: { gte: periodStart, lt: periodEnd } },
    }),
    prisma.product.count({ where: { organizationId, active: true } }),
    prisma.membership.count({ where: { organizationId } }),
  ]);

  return {
    plan: organization.plan,
    limits: limitsFor(organization.plan),
    periodStart,
    periodEnd,
    aiDraftsUsed,
    quotationsUsed,
    productsUsed,
    teamMembers,
  };
}

type MeteredFeature = "aiDraftsPerMonth" | "quotationsPerMonth" | "products" | "teamMembers";

const USED_BY_FEATURE: Record<MeteredFeature, (u: UsageSnapshot) => number> = {
  aiDraftsPerMonth: (u) => u.aiDraftsUsed,
  quotationsPerMonth: (u) => u.quotationsUsed,
  products: (u) => u.productsUsed,
  teamMembers: (u) => u.teamMembers,
};

const FEATURE_LABELS: Record<MeteredFeature, string> = {
  aiDraftsPerMonth: "AI quotation drafts this month",
  quotationsPerMonth: "quotations this month",
  products: "active catalog products",
  teamMembers: "team members",
};

/**
 * Throws `LimitExceededError` when the organization has already reached its plan
 * allowance for `feature`. Callers must invoke this *before* performing the
 * action — no work is started that cannot be completed.
 */
export async function assertWithinLimit(
  organizationId: string,
  feature: MeteredFeature,
  now: Date = new Date(),
): Promise<UsageSnapshot> {
  const usage = await getUsage(organizationId, now);
  const limit = usage.limits[feature];
  const used = USED_BY_FEATURE[feature](usage);

  if (!isWithinLimit(used, limit)) {
    throw new LimitExceededError(
      `Your ${usage.plan} plan allows ${limit} ${FEATURE_LABELS[feature]}. Upgrade to Pro to continue.`,
      { feature, used, limit, plan: usage.plan },
    );
  }

  return usage;
}

export async function recordUsage(organizationId: string, kind: "ai_draft" | "quotation_created") {
  await prisma.usageEvent.create({ data: { organizationId, kind } });
}
