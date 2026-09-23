import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeAuthToken,
  issueAuthToken,
  pruneAuthTokens,
  resolveAuthToken,
} from "@/lib/auth-tokens";
import { prisma } from "@/lib/db";
import { createWorkspace, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

describe("issueAuthToken", () => {
  it("stores only a hash, never the token itself", async () => {
    const workspace = await createWorkspace();
    const issued = await issueAuthToken(workspace.userId, "password_reset");

    const row = await prisma.authToken.findFirstOrThrow();
    expect(row.id).not.toBe(issued.token);
    expect(row.id).not.toContain(issued.token);
    expect(JSON.stringify(row)).not.toContain(issued.token);
  });

  it("puts the token in the link it hands back", async () => {
    const workspace = await createWorkspace();
    const issued = await issueAuthToken(workspace.userId, "password_reset");
    expect(issued.url).toContain("/reset-password/");
    expect(issued.url).toContain(issued.token);
  });

  it("uses a different path for verification", async () => {
    const workspace = await createWorkspace();
    const issued = await issueAuthToken(workspace.userId, "email_verification");
    expect(issued.url).toContain("/verify-email/");
  });

  it("supersedes an earlier unused token for the same purpose", async () => {
    const workspace = await createWorkspace();
    const first = await issueAuthToken(workspace.userId, "password_reset");
    const second = await issueAuthToken(workspace.userId, "password_reset");

    expect(await resolveAuthToken(first.token, "password_reset")).toBeNull();
    expect(await resolveAuthToken(second.token, "password_reset")).not.toBeNull();
    expect(await prisma.authToken.count()).toBe(1);
  });

  it("leaves a token of a different purpose alone", async () => {
    const workspace = await createWorkspace();
    const reset = await issueAuthToken(workspace.userId, "password_reset");
    await issueAuthToken(workspace.userId, "email_verification");

    expect(await resolveAuthToken(reset.token, "password_reset")).not.toBeNull();
  });

  it("expires a reset link after an hour and a verification link after 48", async () => {
    const workspace = await createWorkspace();
    const now = new Date("2026-09-22T10:00:00Z");

    const reset = await issueAuthToken(workspace.userId, "password_reset", { now });
    expect(reset.expiresAt.toISOString()).toBe("2026-09-22T11:00:00.000Z");

    const verify = await issueAuthToken(workspace.userId, "email_verification", { now });
    expect(verify.expiresAt.toISOString()).toBe("2026-09-24T10:00:00.000Z");
  });
});

describe("resolveAuthToken", () => {
  it("refuses a token presented for the wrong purpose", async () => {
    const workspace = await createWorkspace();
    const issued = await issueAuthToken(workspace.userId, "password_reset");

    expect(await resolveAuthToken(issued.token, "email_verification")).toBeNull();
  });

  it("refuses an expired token", async () => {
    const workspace = await createWorkspace();
    const issued = await issueAuthToken(workspace.userId, "password_reset", {
      now: new Date("2026-09-22T10:00:00Z"),
    });

    expect(
      await resolveAuthToken(issued.token, "password_reset", new Date("2026-09-22T11:00:01Z")),
    ).toBeNull();
  });

  it("refuses junk without touching the database", async () => {
    expect(await resolveAuthToken("", "password_reset")).toBeNull();
    expect(await resolveAuthToken("short", "password_reset")).toBeNull();
    expect(await resolveAuthToken("x".repeat(500), "password_reset")).toBeNull();
  });

  it("does not consume the token it resolves", async () => {
    const workspace = await createWorkspace();
    const issued = await issueAuthToken(workspace.userId, "password_reset");

    await resolveAuthToken(issued.token, "password_reset");
    await resolveAuthToken(issued.token, "password_reset");

    expect(await consumeAuthToken(issued.token, "password_reset")).not.toBeNull();
  });
});

describe("consumeAuthToken", () => {
  it("works exactly once", async () => {
    const workspace = await createWorkspace();
    const issued = await issueAuthToken(workspace.userId, "password_reset");

    expect(await consumeAuthToken(issued.token, "password_reset")).not.toBeNull();
    expect(await consumeAuthToken(issued.token, "password_reset")).toBeNull();
  });

  it("lets only one of two concurrent uses win", async () => {
    const workspace = await createWorkspace();
    const issued = await issueAuthToken(workspace.userId, "password_reset");

    const results = await Promise.all([
      consumeAuthToken(issued.token, "password_reset"),
      consumeAuthToken(issued.token, "password_reset"),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("returns the user behind the token", async () => {
    const workspace = await createWorkspace();
    const issued = await issueAuthToken(workspace.userId, "email_verification");

    const consumed = await consumeAuthToken(issued.token, "email_verification");
    expect(consumed?.userId).toBe(workspace.userId);
    expect(consumed?.user.email).toContain("@example.test");
  });
});

describe("pruneAuthTokens", () => {
  it("removes tokens that expired over a day ago, and keeps the rest", async () => {
    const workspace = await createWorkspace();
    await issueAuthToken(workspace.userId, "password_reset", {
      now: new Date("2026-09-01T10:00:00Z"),
    });
    await issueAuthToken(workspace.userId, "email_verification", {
      now: new Date("2026-09-22T10:00:00Z"),
    });

    const removed = await pruneAuthTokens(new Date("2026-09-22T12:00:00Z"));
    expect(removed).toBe(1);
    expect(await prisma.authToken.count()).toBe(1);
  });
});

describe("applyPasswordReset", () => {
  it("installs the new password and refuses the old one", async () => {
    const { applyPasswordReset, authenticate } = await import("@/server/accounts");
    const workspace = await createWorkspace();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: workspace.userId } });
    const issued = await issueAuthToken(user.id, "password_reset");

    await applyPasswordReset(issued.token, "a-brand-new-password");

    await expect(
      authenticate({ email: user.email, password: "a-brand-new-password" }),
    ).resolves.toMatchObject({ userId: user.id });
    await expect(
      authenticate({ email: user.email, password: "correct-horse-battery" }),
    ).rejects.toThrow();
  });

  it("signs the account out everywhere", async () => {
    const { applyPasswordReset } = await import("@/server/accounts");
    const { createSession, resolveSession } = await import("@/lib/session");
    const workspace = await createWorkspace();

    const phone = await createSession(workspace.userId, workspace.organizationId);
    const laptop = await createSession(workspace.userId, workspace.organizationId);
    const issued = await issueAuthToken(workspace.userId, "password_reset");

    const applied = await applyPasswordReset(issued.token, "a-brand-new-password");

    expect(applied?.sessionsEnded).toBe(2);
    expect(await resolveSession(phone.token)).toBeNull();
    expect(await resolveSession(laptop.token)).toBeNull();
  });

  it("leaves another account's sessions alone", async () => {
    const { applyPasswordReset } = await import("@/server/accounts");
    const { createSession, resolveSession } = await import("@/lib/session");
    const mine = await createWorkspace();
    const theirs = await createWorkspace();

    const theirSession = await createSession(theirs.userId, theirs.organizationId);
    const issued = await issueAuthToken(mine.userId, "password_reset");

    await applyPasswordReset(issued.token, "a-brand-new-password");
    expect(await resolveSession(theirSession.token)).not.toBeNull();
  });

  it("drops every other outstanding reset link", async () => {
    const { applyPasswordReset } = await import("@/server/accounts");
    const workspace = await createWorkspace();

    // Two live links can exist only if one was minted outside issueAuthToken,
    // which supersedes; build that state directly to prove the sweep works.
    const used = await issueAuthToken(workspace.userId, "password_reset");
    await prisma.authToken.create({
      data: {
        id: "stale-reset-token-row",
        userId: workspace.userId,
        purpose: "password_reset",
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    await applyPasswordReset(used.token, "a-brand-new-password");

    expect(
      await prisma.authToken.count({
        where: { userId: workspace.userId, purpose: "password_reset", usedAt: null },
      }),
    ).toBe(0);
  });

  it("returns null for a spent or unknown link, changing nothing", async () => {
    const { applyPasswordReset, authenticate } = await import("@/server/accounts");
    const workspace = await createWorkspace();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: workspace.userId } });
    const issued = await issueAuthToken(user.id, "password_reset");

    await applyPasswordReset(issued.token, "first-new-password");
    expect(await applyPasswordReset(issued.token, "second-new-password")).toBeNull();

    await expect(
      authenticate({ email: user.email, password: "first-new-password" }),
    ).resolves.toBeTruthy();
  });
});
