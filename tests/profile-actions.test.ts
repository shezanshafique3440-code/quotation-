import { beforeEach, describe, expect, it, vi } from "vitest";
import { idleState } from "@/lib/action-state";
import { prisma } from "@/lib/db";
import { createSession, requireSession, resolveSession } from "@/lib/session";
import { updateBusinessProfileAction } from "@/server/profile-actions";
import { createWorkspace, resetDatabase, type Workspace } from "./helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/session")>(),
  requireSession: vi.fn(),
}));

let workspace: Workspace;

function profileForm(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    legalName: "Updated Workspace",
    currency: "USD",
    locale: "en-US",
    taxRate: "10",
    quoteNumberPrefix: "QT",
    defaultValidityDays: "14",
    timezone: "UTC",
    autoFollowUpDays: "3",
    ...overrides,
  })) data.set(key, value);
  return data;
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace({ plan: "free" });
  const session = await createSession(workspace.userId, workspace.organizationId);
  vi.mocked(requireSession).mockResolvedValue((await resolveSession(session.token))!);
});

describe("business profile branding", () => {
  const brandingChanges: Record<string, string>[] = [
    { brandColor: "#123456" },
    { logoUrl: "https://example.com/logo.png" },
    { portalHeadline: "Custom portal" },
    { portalMessage: "Custom welcome" },
  ];
  it.each(brandingChanges)("rejects a Free workspace changing branding: %j", async (change) => {
    const before = await prisma.businessProfile.findUniqueOrThrow({ where: { organizationId: workspace.organizationId } });
    const reply = await updateBusinessProfileAction(idleState, profileForm(change));
    expect(reply.status).toBe("error");
    expect(reply.message).toContain("Pro");
    expect(await prisma.businessProfile.findUniqueOrThrow({ where: { organizationId: workspace.organizationId } })).toEqual(before);
  });

  it("allows unrelated changes after a downgrade while preserving existing branding", async () => {
    const branding = {
      brandColor: "#123456",
      logoUrl: "https://example.com/logo.png",
      portalHeadline: "Customer workspace",
      portalMessage: "Your quotations",
    };
    await prisma.businessProfile.update({ where: { organizationId: workspace.organizationId }, data: branding });

    const reply = await updateBusinessProfileAction(idleState, profileForm({ locale: "en-GB", timezone: "Asia/Karachi" }));
    expect(reply.status).toBe("success");
    expect(await prisma.businessProfile.findUniqueOrThrow({ where: { organizationId: workspace.organizationId } }))
      .toMatchObject({ ...branding, legalName: "Updated Workspace", locale: "en-GB", timezone: "Asia/Karachi" });
  });

  it("uses the current plan so a newly upgraded workspace can change branding", async () => {
    await prisma.organization.update({ where: { id: workspace.organizationId }, data: { plan: "pro" } });
    const branding = {
      brandColor: "#123456",
      logoUrl: "https://example.com/logo.png",
      portalHeadline: "Customer workspace",
      portalMessage: "Your quotations",
    };

    const reply = await updateBusinessProfileAction(idleState, profileForm(branding));
    expect(reply.status).toBe("success");
    expect(await prisma.businessProfile.findUniqueOrThrow({ where: { organizationId: workspace.organizationId } })).toMatchObject(branding);
  });
});

describe("catalog currency protection", () => {
  it("refuses to relabel existing catalog prices with a new currency", async () => {
    const product = await prisma.product.findUniqueOrThrow({ where: { id: workspace.productId } });
    const reply = await updateBusinessProfileAction(idleState, profileForm({ currency: "GBP" }));

    expect(reply.status).toBe("error");
    expect(reply.message).toContain("catalog prices");
    expect((await prisma.businessProfile.findUniqueOrThrow({ where: { organizationId: workspace.organizationId } })).currency).toBe("USD");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).unitPriceCents).toBe(product.unitPriceCents);
  });

  it("allows currency changes when there are no catalog prices to reinterpret", async () => {
    await prisma.product.deleteMany({ where: { organizationId: workspace.organizationId } });
    const reply = await updateBusinessProfileAction(idleState, profileForm({ currency: "GBP" }));

    expect(reply.status).toBe("success");
    expect((await prisma.businessProfile.findUniqueOrThrow({ where: { organizationId: workspace.organizationId } })).currency).toBe("GBP");
  });
});
