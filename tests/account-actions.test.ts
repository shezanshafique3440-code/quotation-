import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { idleState } from "@/lib/action-state";
import { prisma } from "@/lib/db";
import { __setEmailTransportForTests } from "@/lib/email";
import { resetEnvCache } from "@/lib/env";
import { createInvitation, resolveInvitation } from "@/lib/invitations";
import { createSession, requireSession, resolveSession } from "@/lib/session";
import { requestPasswordResetAction } from "@/server/account-actions";
import { inviteMemberAction, resendInvitationAction } from "@/server/member-actions";
import { createWorkspace, resetDatabase, type Workspace } from "./helpers";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/session")>(),
  requireSession: vi.fn(),
}));

const ORIGINAL = { ...process.env };
let workspace: Workspace;

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace({ plan: "pro" });
  const session = await createSession(workspace.userId, workspace.organizationId);
  vi.mocked(requireSession).mockResolvedValue((await resolveSession(session.token))!);
  vi.mocked(revalidatePath).mockClear();
  process.env.EMAIL_PROVIDER = "resend";
  process.env.EMAIL_FROM = "QuoteFlow <quotes@example.com>";
  process.env.RESEND_API_KEY = "re_test";
  resetEnvCache();
  __setEmailTransportForTests({ name: "resend", async send() { throw new Error("provider unavailable"); } });
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
  resetEnvCache();
  __setEmailTransportForTests(null);
});

describe("password reset privacy", () => {
  it("returns the same public reply for an unknown address and a failed delivery to an existing account", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: workspace.userId } });
    const known = await requestPasswordResetAction(idleState, form({ email: user.email }));
    const unknown = await requestPasswordResetAction(idleState, form({ email: "unknown@example.test" }));

    expect(known).toEqual(unknown);
    expect(known.status).toBe("success");
    const delivery = await prisma.emailDelivery.findFirstOrThrow({ where: { kind: "password_reset" } });
    expect(delivery.status).toBe("failed");
    expect(delivery.error).toContain("provider unavailable");
  });
});

describe("invitation delivery recovery", () => {
  it("returns a usable invitation link when the initial email fails", async () => {
    const reply = await inviteMemberAction(idleState, form({ email: "teammate@example.test", role: "member" }));
    expect(reply.status).toBe("error");
    expect(reply.message).toContain("provider unavailable");
    const token = new URL(reply.data!.url as string).pathname.split("/").at(-1)!;
    expect(await resolveInvitation(token)).toMatchObject({ email: "teammate@example.test" });
    expect(reply.data!.invitationId).toBe((await resolveInvitation(token))!.id);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([true, false])("returns the replacement link when email is %s", async (enabled) => {
    const invitation = await createInvitation({
      organizationId: workspace.organizationId,
      plan: "pro",
      email: "teammate@example.test",
      role: "member",
      actor: { userId: workspace.userId, label: "Owner" },
    });
    if (!enabled) {
      process.env.EMAIL_PROVIDER = "none";
      resetEnvCache();
    }

    const reply = await resendInvitationAction(idleState, form({ invitationId: invitation.id }));
    expect(reply.status).toBe(enabled ? "error" : "success");
    const token = new URL(reply.data!.url as string).pathname.split("/").at(-1)!;
    expect(await resolveInvitation(invitation.token)).toBeNull();
    expect(await resolveInvitation(token)).toMatchObject({ id: reply.data!.invitationId });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
