import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  RATE_LIMITS,
  RateLimitedError,
  consumeRateLimit,
  enforceRateLimit,
  pruneRateLimits,
} from "@/lib/rate-limit";
import { resetDatabase } from "./helpers";

beforeEach(resetDatabase);

const START = new Date("2026-04-01T10:00:00Z");

describe("consumeRateLimit", () => {
  it("allows up to the limit and then refuses", async () => {
    const limit = RATE_LIMITS.signIn.limit;

    for (let i = 0; i < limit; i += 1) {
      const result = await consumeRateLimit("signIn", "1.2.3.4", START);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(limit - i - 1);
    }

    const blocked = await consumeRateLimit("signIn", "1.2.3.4", START);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps separate buckets per identifier and per limit name", async () => {
    for (let i = 0; i < RATE_LIMITS.signIn.limit; i += 1) {
      await consumeRateLimit("signIn", "1.2.3.4", START);
    }

    expect((await consumeRateLimit("signIn", "1.2.3.4", START)).allowed).toBe(false);
    expect((await consumeRateLimit("signIn", "5.6.7.8", START)).allowed).toBe(true);
    expect((await consumeRateLimit("signUp", "1.2.3.4", START)).allowed).toBe(true);
  });

  it("opens a fresh window once the old one has passed", async () => {
    for (let i = 0; i < RATE_LIMITS.signIn.limit; i += 1) {
      await consumeRateLimit("signIn", "1.2.3.4", START);
    }
    expect((await consumeRateLimit("signIn", "1.2.3.4", START)).allowed).toBe(false);

    const afterWindow = new Date(START.getTime() + RATE_LIMITS.signIn.windowMs + 1);
    const result = await consumeRateLimit("signIn", "1.2.3.4", afterWindow);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(RATE_LIMITS.signIn.limit - 1);
  });

  it("reports a reset time inside the configured window", async () => {
    const result = await consumeRateLimit("publicRespond", "1.2.3.4", START);
    expect(result.resetAt.getTime()).toBe(START.getTime() + RATE_LIMITS.publicRespond.windowMs);
  });

  it("shares one counter row per key, so the limit is not per-process", async () => {
    await consumeRateLimit("publicView", "1.2.3.4", START);
    await consumeRateLimit("publicView", "1.2.3.4", START);

    const rows = await prisma.rateLimitCounter.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.key).toBe("publicView:1.2.3.4");
    expect(rows[0]!.count).toBe(2);
  });
});

describe("enforceRateLimit", () => {
  it("throws a 429 carrying a retry hint once the limit is hit", async () => {
    for (let i = 0; i < RATE_LIMITS.publicRespond.limit; i += 1) {
      await enforceRateLimit("publicRespond", "9.9.9.9", START);
    }

    const error = (await enforceRateLimit("publicRespond", "9.9.9.9", START).catch(
      (e) => e,
    )) as RateLimitedError;

    expect(error).toBeInstanceOf(RateLimitedError);
    expect(error.status).toBe(429);
    expect(error.code).toBe("rate_limited");
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    expect(error.message).toMatch(/try again in/i);
  });

  it("passes silently while under the limit", async () => {
    await expect(enforceRateLimit("aiGenerate", "org:1", START)).resolves.toBeUndefined();
  });
});

describe("pruneRateLimits", () => {
  it("removes only windows that have already closed", async () => {
    await consumeRateLimit("signIn", "old", START);
    await consumeRateLimit("publicView", "new", new Date(START.getTime() + 60 * 60_000));

    const pruned = await pruneRateLimits(new Date(START.getTime() + 30 * 60_000));
    expect(pruned).toBe(1);

    const remaining = await prisma.rateLimitCounter.findMany({ select: { key: true } });
    expect(remaining.map((r) => r.key)).toEqual(["publicView:new"]);
  });
});
