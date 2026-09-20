import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { authenticate, registerAccount } from "@/server/accounts";
import { resetDatabase } from "./helpers";

const input = {
  name: "Sam Rivera",
  email: "sam@northline.test",
  password: "correct-horse-battery",
  businessName: "Northline Joinery",
};

beforeEach(resetDatabase);

describe("registerAccount", () => {
  it("creates the user, workspace, owner membership and profile together", async () => {
    const account = await registerAccount(input);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: account.userId } });
    expect(user.email).toBe("sam@northline.test");
    expect(user.passwordHash).not.toContain(input.password);

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: account.organizationId },
      include: { profile: true, memberships: true },
    });
    expect(organization.slug).toBe("northline-joinery");
    expect(organization.plan).toBe("free");
    expect(organization.profile?.legalName).toBe("Northline Joinery");
    expect(organization.memberships[0]!.role).toBe("owner");
  });

  it("rejects a duplicate email and leaves no orphan workspace", async () => {
    await registerAccount(input);
    await expect(registerAccount({ ...input, businessName: "Other" })).rejects.toThrow(AppError);
    expect(await prisma.organization.count()).toBe(1);
  });

  it("gives colliding business names distinct slugs", async () => {
    await registerAccount(input);
    const second = await registerAccount({ ...input, email: "two@northline.test" });

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: second.organizationId },
    });
    expect(organization.slug).not.toBe("northline-joinery");
    expect(organization.slug.startsWith("northline-joinery-")).toBe(true);
  });

  it("falls back to a usable slug when the name has no latin characters", async () => {
    const account = await registerAccount({ ...input, email: "x@y.test", businessName: "***" });
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: account.organizationId },
    });
    expect(organization.slug).toBe("workspace");
  });
});

describe("authenticate", () => {
  it("returns the user and their workspace for correct credentials", async () => {
    const account = await registerAccount(input);
    const result = await authenticate({ email: input.email, password: input.password });
    expect(result).toEqual({ userId: account.userId, organizationId: account.organizationId });
  });

  it("gives the same error for an unknown email and a wrong password", async () => {
    await registerAccount(input);

    const wrongPassword = (await authenticate({
      email: input.email,
      password: "nope-nope-nope",
    }).catch((e) => e)) as AppError;
    const unknownEmail = (await authenticate({
      email: "nobody@northline.test",
      password: input.password,
    }).catch((e) => e)) as AppError;

    expect(wrongPassword.message).toBe(unknownEmail.message);
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
  });

  it("refuses a user whose membership was removed", async () => {
    const account = await registerAccount(input);
    await prisma.membership.deleteMany({ where: { userId: account.userId } });

    await expect(authenticate({ email: input.email, password: input.password })).rejects.toThrow(
      /not attached to a workspace/i,
    );
  });
});
