import { prisma } from "./db";
import { AppError } from "./errors";

export interface RateLimitRule {
  /** Requests permitted inside one window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
}

/**
 * Named limits. Public, unauthenticated surfaces are tightest; a signed-in
 * user's own actions are looser because they are already attributable.
 */
export const RATE_LIMITS = {
  signIn: { limit: 10, windowMs: 15 * 60_000 },
  signUp: { limit: 5, windowMs: 60 * 60_000 },
  publicView: { limit: 120, windowMs: 60_000 },
  publicRespond: { limit: 10, windowMs: 60 * 60_000 },
  portalAccess: { limit: 60, windowMs: 60_000 },
  aiGenerate: { limit: 20, windowMs: 60 * 60_000 },
  emailSend: { limit: 60, windowMs: 60 * 60_000 },
  pdfDownload: { limit: 60, windowMs: 60_000 },
  webhook: { limit: 600, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/**
 * Fixed-window counter kept in the database, so the limit is shared by every
 * instance rather than being per-process.
 *
 * Two racing requests can both read the same count; the window is short and
 * the consequence is one extra request, which is the right trade against
 * requiring a separate store for an MVP. A precise limiter (Redis token
 * bucket) is the production upgrade path.
 */
export async function consumeRateLimit(
  name: RateLimitName,
  identifier: string,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[name];
  const key = `${name}:${identifier}`;

  const existing = await prisma.rateLimitCounter.findUnique({ where: { key } });

  if (!existing || existing.windowEndsAt.getTime() <= now.getTime()) {
    const windowEndsAt = new Date(now.getTime() + rule.windowMs);
    await prisma.rateLimitCounter.upsert({
      where: { key },
      create: { key, count: 1, windowEndsAt },
      update: { count: 1, windowEndsAt },
    });
    return {
      allowed: true,
      remaining: rule.limit - 1,
      resetAt: windowEndsAt,
      retryAfterSeconds: Math.ceil(rule.windowMs / 1000),
    };
  }

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((existing.windowEndsAt.getTime() - now.getTime()) / 1000),
  );

  if (existing.count >= rule.limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.windowEndsAt,
      retryAfterSeconds,
    };
  }

  const updated = await prisma.rateLimitCounter.update({
    where: { key },
    data: { count: { increment: 1 } },
  });

  return {
    allowed: true,
    remaining: Math.max(0, rule.limit - updated.count),
    resetAt: existing.windowEndsAt,
    retryAfterSeconds,
  };
}

export class RateLimitedError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message?: string) {
    super(
      message ??
        `Too many attempts. Try again in ${formatRetry(retryAfterSeconds)}.`,
      { status: 429, code: "rate_limited", details: { retryAfterSeconds } },
    );
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function formatRetry(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** Consume a slot or throw. */
export async function enforceRateLimit(
  name: RateLimitName,
  identifier: string,
  now: Date = new Date(),
): Promise<void> {
  const result = await consumeRateLimit(name, identifier, now);
  if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds);
}

/** Housekeeping for the cron endpoint; expired rows are dead weight. */
export async function pruneRateLimits(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.rateLimitCounter.deleteMany({
    where: { windowEndsAt: { lt: now } },
  });
  return count;
}
