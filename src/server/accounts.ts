import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { hashPassword, verifyPassword } from "@/lib/password";
import { slugify } from "@/lib/slug";
import type { SignInInput, SignUpInput } from "@/lib/validation";

/** Reserve a unique slug, appending a short random suffix on collision. */
async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${randomBytes(3).toString("hex")}`;
    const taken = await prisma.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  throw new AppError("Could not create a workspace URL. Please try a different business name.");
}

export interface RegisteredAccount {
  userId: string;
  organizationId: string;
}

/**
 * Create the user, their workspace, the owner membership and a starter business
 * profile in one transaction — a half-created account cannot sign in.
 */
export async function registerAccount(input: SignUpInput): Promise<RegisteredAccount> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) {
    throw new AppError("An account with that email already exists. Sign in instead.", {
      status: 409,
      code: "email_taken",
    });
  }

  const [passwordHash, slug] = await Promise.all([
    hashPassword(input.password),
    uniqueSlug(input.businessName),
  ]);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, name: input.name, passwordHash },
      });
      const organization = await tx.organization.create({
        data: {
          name: input.businessName,
          slug,
          profile: { create: { legalName: input.businessName } },
          memberships: { create: { userId: user.id, role: "owner" } },
        },
      });
      return { userId: user.id, organizationId: organization.id };
    });
    return result;
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
      throw new AppError("An account with that email already exists. Sign in instead.", {
        status: 409,
        code: "email_taken",
      });
    }
    throw error;
  }
}

export interface AuthenticatedUser {
  userId: string;
  organizationId: string;
}

const GENERIC_SIGNIN_ERROR = "Those credentials did not match an account.";

/**
 * Verify credentials. The same message is returned for an unknown email and a
 * wrong password, and a dummy hash is verified when the user is missing so the
 * response time does not reveal which emails are registered.
 */
export async function authenticate(input: SignInInput): Promise<AuthenticatedUser> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { memberships: { orderBy: { createdAt: "asc" }, take: 1 } },
  });

  if (!user) {
    await verifyPassword(input.password, DUMMY_HASH);
    throw new AppError(GENERIC_SIGNIN_ERROR, { status: 401, code: "invalid_credentials" });
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    throw new AppError(GENERIC_SIGNIN_ERROR, { status: 401, code: "invalid_credentials" });
  }

  const membership = user.memberships[0];
  if (!membership) {
    throw new AppError("Your account is not attached to a workspace. Contact support.", {
      status: 403,
    });
  }

  return { userId: user.id, organizationId: membership.organizationId };
}

// A real scrypt hash of a value nobody can supply, used only for timing parity.
const DUMMY_HASH =
  "scrypt$16384$8$1$Y2FuYXJ5c2FsdGNhbmFyeQ$RUq6gYMk3ZJ3Xz0m6nO2rN1kq0Wl9Yl7Vw3s8wXqjJ5t2Yc0Z1n6lQ7kK4pM3bR";
