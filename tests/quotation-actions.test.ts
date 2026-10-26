import { beforeEach, describe, expect, it, vi } from "vitest";
import { idleState } from "@/lib/action-state";
import { ACTIVITY_KINDS, recordActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { requireSession, type SessionContext } from "@/lib/session";
import { updateQuotationStatusAction } from "@/server/quotation-actions";
import { createSharedQuotation, createWorkspace, resetDatabase, type Workspace } from "./helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDatabase();
});

async function signIn(workspace: Workspace) {
  const [user, organization] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: workspace.userId } }),
    prisma.organization.findUniqueOrThrow({ where: { id: workspace.organizationId } }),
  ]);
  const session: SessionContext = {
    sessionId: "test-session",
    userId: user.id,
    organizationId: organization.id,
    user,
    organization,
    role: "owner",
  };
  vi.mocked(requireSession).mockResolvedValue(session);
}

function statusForm(id: string, status: string): FormData {
  const form = new FormData();
  form.set("id", id);
  form.set("status", status);
  return form;
}

describe("quotation status actions", () => {
  it("clears the previous response and view lifecycle when reopening a rejected quotation", async () => {
    const workspace = await createWorkspace();
    await signIn(workspace);
    const quotation = await createSharedQuotation(workspace, { status: "rejected" });
    const respondedAt = new Date("2026-06-01T12:00:00Z");
    await prisma.quotation.update({
      where: { id: quotation.id },
      data: {
        respondedAt,
        decidedAt: respondedAt,
        respondedByName: "Customer",
        rejectionReason: "Please revise the scope.",
        decisionSource: "public_page",
        signatureName: "Previous signature",
        signatureEmail: "previous@example.test",
        signedAt: respondedAt,
        signatureIpHash: "previous-fingerprint",
        firstViewedAt: respondedAt,
        lastViewedAt: respondedAt,
        viewCount: 2,
      },
    });
    await recordActivity({
      organizationId: workspace.organizationId,
      category: "quotation",
      kind: ACTIVITY_KINDS.quotationRejected,
      summary: "Customer requested a revision",
      actorType: "customer",
      actorLabel: "Customer",
      quotationId: quotation.id,
      customerId: workspace.customerId,
    });
    const oldEvent = await prisma.activityEvent.findFirstOrThrow({
      where: { quotationId: quotation.id, kind: ACTIVITY_KINDS.quotationRejected },
    });

    const state = await updateQuotationStatusAction(idleState, statusForm(quotation.id, "draft"));
    expect(state.status).toBe("success");
    expect(await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } })).toMatchObject({
      status: "draft",
      sentAt: null,
      decidedAt: null,
      decisionSource: null,
      respondedAt: null,
      respondedByName: null,
      rejectionReason: null,
      signatureName: null,
      signatureEmail: null,
      signedAt: null,
      signatureIpHash: null,
      firstViewedAt: null,
      lastViewedAt: null,
      viewCount: 0,
    });
    // Resetting current fields must preserve the original audit trail.
    expect(await prisma.activityEvent.findUnique({ where: { id: oldEvent.id } })).not.toBeNull();
    expect(await prisma.activityEvent.count({
      where: { quotationId: quotation.id, kind: ACTIVITY_KINDS.quotationReopened },
    })).toBe(1);
  });

  it.each(["draft", "expired"])("cancels pending follow-ups when a sent quotation becomes %s", async (status) => {
    const workspace = await createWorkspace();
    await signIn(workspace);
    const quotation = await createSharedQuotation(workspace);
    const reminder = await prisma.reminder.create({
      data: {
        organizationId: workspace.organizationId,
        quotationId: quotation.id,
        channel: "email",
        dueAt: new Date(Date.now() + 86_400_000),
      },
    });

    const state = await updateQuotationStatusAction(idleState, statusForm(quotation.id, status));
    expect(state.status).toBe("success");
    expect(await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id } })).toMatchObject({
      status: "cancelled",
    });
  });

  it("keeps an accepted quotation and its acceptance evidence immutable", async () => {
    const workspace = await createWorkspace();
    await signIn(workspace);
    const quotation = await createSharedQuotation(workspace, { status: "accepted" });
    const respondedAt = new Date();
    await prisma.quotation.update({
      where: { id: quotation.id },
      data: { respondedAt, signatureName: "Customer", signedAt: respondedAt },
    });

    const state = await updateQuotationStatusAction(idleState, statusForm(quotation.id, "draft"));
    expect(state.status).toBe("error");
    expect(await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } })).toMatchObject({
      status: "accepted",
      respondedAt,
      signatureName: "Customer",
      signedAt: respondedAt,
    });
  });
});
