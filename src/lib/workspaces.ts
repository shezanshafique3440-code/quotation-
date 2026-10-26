import { prisma } from "./db";
import { ForbiddenError, UnauthorizedError } from "./errors";
import type { SessionContext } from "./session";

export interface WorkspaceOption {
  id: string;
  name: string;
  role: string;
}

/** Only workspaces the signed-in user can currently access. */
export async function listWorkspaces(userId: string): Promise<WorkspaceOption[]> {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { role: true, organization: { select: { id: true, name: true } } },
  });
  return memberships.map(({ role, organization }) => ({ ...organization, role }));
}

/**
 * Move this session only. The token and its original expiry stay unchanged;
 * resolving it again reads the destination membership's current role.
 */
export async function switchWorkspace(
  session: Pick<SessionContext, "sessionId" | "userId" | "organizationId">,
  organizationId: string,
  now: Date = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const validSession = await tx.session.findFirst({
      where: {
        id: session.sessionId,
        userId: session.userId,
        organizationId: session.organizationId,
        expiresAt: { gt: now },
        organization: { memberships: { some: { userId: session.userId } } },
      },
      select: { id: true },
    });
    if (!validSession) throw new UnauthorizedError("Your session has expired. Please sign in again.");

    const membership = await tx.membership.findUnique({
      where: {
        userId_organizationId: { userId: session.userId, organizationId },
      },
      select: { id: true },
    });
    if (!membership) throw new ForbiddenError("You no longer have access to that workspace.");

    // Check memberships again in the mutation itself so a stale picker cannot
    // restore access after removal, or mutate another user's session.
    const result = await tx.session.updateMany({
      where: {
        id: session.sessionId,
        userId: session.userId,
        organizationId: session.organizationId,
        expiresAt: { gt: now },
        organization: { memberships: { some: { userId: session.userId } } },
        user: { memberships: { some: { organizationId } } },
      },
      data: { organizationId },
    });
    if (result.count !== 1) {
      throw new UnauthorizedError("Your workspace access has changed. Please sign in again.");
    }
  });
}
