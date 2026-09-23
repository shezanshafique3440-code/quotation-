import { fingerprint, randomToken } from "./crypto";
import { prisma } from "./db";
import { getEnv } from "./env";

/**
 * One-time credentials emailed to a user.
 *
 * Only an HMAC of the token is stored, so the raw value lives exactly once —
 * in the message that was sent. Nothing here can hand a token back; a lost
 * link can only be replaced by issuing a new one.
 */
export const AUTH_TOKEN_PURPOSES = ["password_reset", "email_verification"] as const;
export type AuthTokenPurpose = (typeof AUTH_TOKEN_PURPOSES)[number];

export const PASSWORD_RESET_TTL_MINUTES = 60;
export const EMAIL_VERIFICATION_TTL_HOURS = 48;

function tokenId(token: string, purpose: AuthTokenPurpose): string {
  return fingerprint(token, purpose);
}

export interface IssuedAuthToken {
  token: string;
  url: string;
  expiresAt: Date;
}

function authUrl(path: string): string {
  return `${getEnv().APP_URL.replace(/\/$/, "")}${path}`;
}

export function passwordResetUrl(token: string): string {
  return authUrl(`/reset-password/${token}`);
}

export function emailVerificationUrl(token: string): string {
  return authUrl(`/verify-email/${token}`);
}

/**
 * Mint a token, invalidating any earlier one for the same user and purpose.
 *
 * Superseding rather than accumulating means a stolen older link stops working
 * the moment the real user asks for a new one.
 */
export async function issueAuthToken(
  userId: string,
  purpose: AuthTokenPurpose,
  options: { ipHash?: string | null; now?: Date } = {},
): Promise<IssuedAuthToken> {
  const now = options.now ?? new Date();
  const ttlMs =
    purpose === "password_reset"
      ? PASSWORD_RESET_TTL_MINUTES * 60_000
      : EMAIL_VERIFICATION_TTL_HOURS * 3_600_000;

  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + ttlMs);

  await prisma.$transaction([
    prisma.authToken.deleteMany({ where: { userId, purpose, usedAt: null } }),
    prisma.authToken.create({
      data: {
        id: tokenId(token, purpose),
        userId,
        purpose,
        expiresAt,
        requestedIpHash: options.ipHash ?? null,
      },
    }),
  ]);

  return {
    token,
    url: purpose === "password_reset" ? passwordResetUrl(token) : emailVerificationUrl(token),
    expiresAt,
  };
}

export interface ResolvedAuthToken {
  id: string;
  userId: string;
  user: { id: string; email: string; name: string; emailVerifiedAt: Date | null };
}

/**
 * Look a token up without consuming it, for rendering the form behind it.
 *
 * Returns null for anything not currently usable — unknown, expired or already
 * spent — so a caller cannot accidentally treat a dead link as live.
 */
export async function resolveAuthToken(
  token: string,
  purpose: AuthTokenPurpose,
  now: Date = new Date(),
): Promise<ResolvedAuthToken | null> {
  if (!token || token.length < 16 || token.length > 128) return null;

  const record = await prisma.authToken.findUnique({
    where: { id: tokenId(token, purpose) },
    include: {
      user: { select: { id: true, email: true, name: true, emailVerifiedAt: true } },
    },
  });

  if (!record) return null;
  if (record.purpose !== purpose) return null;
  if (record.usedAt) return null;
  if (record.expiresAt.getTime() <= now.getTime()) return null;

  return { id: record.id, userId: record.userId, user: record.user };
}

/**
 * Spend a token.
 *
 * The update is conditional on `usedAt` still being null, so two requests
 * racing on the same link result in exactly one success.
 */
export async function consumeAuthToken(
  token: string,
  purpose: AuthTokenPurpose,
  now: Date = new Date(),
): Promise<ResolvedAuthToken | null> {
  const resolved = await resolveAuthToken(token, purpose, now);
  if (!resolved) return null;

  const { count } = await prisma.authToken.updateMany({
    where: { id: resolved.id, usedAt: null },
    data: { usedAt: now },
  });
  if (count === 0) return null;

  return resolved;
}

/** Housekeeping for the scheduled endpoint. */
export async function pruneAuthTokens(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.authToken.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } },
  });
  return count;
}
