import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { getEnv } from "./env";
import { UnauthorizedError } from "./errors";

export const SESSION_COOKIE = "qf_session";
export const SESSION_TTL_DAYS = 30;

/**
 * The cookie holds a high-entropy random token; the database holds only an
 * HMAC of it keyed by SESSION_SECRET. A database leak therefore does not yield
 * usable session tokens.
 */
function tokenFingerprint(token: string): string {
  const secret = getEnv().SESSION_SECRET;
  if (secret) return createHmac("sha256", secret).update(token).digest("hex");
  // Development fallback: still never store the raw token.
  return createHash("sha256").update(token).digest("hex");
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createSession(userId: string, organizationId: string) {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: { id: tokenFingerprint(token), userId, organizationId, expiresAt },
  });

  return { token, expiresAt };
}

export interface SessionContext {
  sessionId: string;
  userId: string;
  organizationId: string;
  user: { id: string; email: string; name: string };
  organization: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    planStatus: string;
  };
  role: string;
}

export async function resolveSession(token: string | undefined): Promise<SessionContext | null> {
  if (!token) return null;

  const record = await prisma.session.findUnique({
    where: { id: tokenFingerprint(token) },
    include: { user: true, organization: true },
  });
  if (!record) return null;

  if (record.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: record.id } }).catch(() => undefined);
    return null;
  }

  // The membership is re-checked on every request so that removing a user from
  // an organization takes effect immediately rather than at session expiry.
  const membership = await prisma.membership.findUnique({
    where: {
      userId_organizationId: { userId: record.userId, organizationId: record.organizationId },
    },
  });
  if (!membership) return null;

  return {
    sessionId: record.id,
    userId: record.userId,
    organizationId: record.organizationId,
    user: { id: record.user.id, email: record.user.email, name: record.user.name },
    organization: {
      id: record.organization.id,
      name: record.organization.name,
      slug: record.organization.slug,
      plan: record.organization.plan,
      planStatus: record.organization.planStatus,
    },
    role: membership.role,
  };
}

export async function getSession(): Promise<SessionContext | null> {
  const store = await cookies();
  return resolveSession(store.get(SESSION_COOKIE)?.value);
}

export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: getEnv().NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { id: tokenFingerprint(token) } });
  }
  store.delete(SESSION_COOKIE);
}

/** Constant-time string compare for shared secrets (cron, webhooks). */
export function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
