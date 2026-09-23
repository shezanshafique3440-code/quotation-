import type { Metadata } from "next";
import { ConfirmForm } from "@/components/confirm-form";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { isEmailConfigured } from "@/lib/env";
import { seatUsage } from "@/lib/invitations";
import { listMembers, listPendingInvitations } from "@/lib/members";
import { PLAN_LABELS } from "@/lib/plans";
import { can, canActOn, isRole, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/roles";
import { requireTenant } from "@/lib/tenant";
import { removeMemberAction, resendInvitationAction, revokeInvitationAction } from "@/server/member-actions";
import { InvitePanel } from "./invite-panel";
import { RoleSelect } from "./role-select";

export const metadata: Metadata = { title: "Teammates" };

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ removed?: string; revoked?: string }>;
}) {
  const { removed, revoked } = await searchParams;
  const { session, fmt } = await requireTenant();

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organizationId },
    select: { plan: true },
  });

  const [members, pending, seats] = await Promise.all([
    listMembers(session.organizationId),
    listPendingInvitations(session.organizationId),
    seatUsage(session.organizationId, organization.plan),
  ]);

  const manages = can(session.role, "members:manage");
  const isOwner = session.role === "owner";
  const seatsLeft = seats.limit === null ? null : Math.max(0, seats.limit - seats.used);
  const planLabel = PLAN_LABELS[organization.plan === "pro" ? "pro" : "free"];

  return (
    <>
      <PageHeader
        title="Teammates"
        description={
          seats.limit === null
            ? `${seats.members} in this workspace`
            : `${seats.used} of ${seats.limit} ${seats.limit === 1 ? "seat" : "seats"} used on the ${planLabel} plan${
                seats.pending > 0 ? `, including ${seats.pending} pending` : ""
              }`
        }
      />

      {removed ? (
        <Alert tone="positive" title="Removed">
          {removed} no longer has access to this workspace. Their sessions stopped working
          immediately.
        </Alert>
      ) : null}
      {revoked ? (
        <Alert tone="positive" title="Invitation revoked">
          That link no longer works. Invite the address again if you change your mind.
        </Alert>
      ) : null}

      {!manages ? (
        <Alert tone="brand" title="You can see the team, but not change it">
          Inviting and removing people is limited to owners and admins.
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="People"
          description="Everyone who can sign in to this workspace."
        />
        <ul className="divide-y divide-[var(--color-line)]">
          {members.map((member) => {
            const role = isRole(member.role) ? member.role : "member";
            const isSelf = member.userId === session.userId;
            const mayAct = manages && !isSelf && canActOn(session.role, member.role);

            return (
              <li key={member.membershipId} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {member.name}
                      {isSelf ? <Badge tone="brand">You</Badge> : null}
                      {member.emailVerifiedAt ? null : (
                        <Badge tone="warning">Email unconfirmed</Badge>
                      )}
                    </p>
                    <p className="truncate text-sm text-[var(--color-ink-muted)]">
                      {member.email}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-ink-subtle)]">
                      {ROLE_LABELS[role]} · joined {fmt.date(member.joinedAt)}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    {mayAct ? (
                      <RoleSelect
                        membershipId={member.membershipId}
                        role={member.role}
                        allowOwner={isOwner}
                      />
                    ) : (
                      <Badge tone={role === "owner" ? "positive" : "neutral"}>
                        {ROLE_LABELS[role]}
                      </Badge>
                    )}

                    {mayAct ? (
                      <ConfirmForm
                        action={removeMemberAction}
                        fields={{ membershipId: member.membershipId }}
                        label="Remove"
                        pendingLabel="Removing…"
                        variant="danger"
                        confirm={`Remove ${member.email} from this workspace? They lose access immediately.`}
                      />
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {manages ? (
        <Card>
          <CardHeader
            title="Pending invitations"
            description="Sent but not yet accepted."
          />
          {pending.length === 0 ? (
            <EmptyState
              title="No invitations waiting"
              description="Invite someone below and they will appear here until they join."
            />
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {pending.map((invitation) => {
                const role = isRole(invitation.role) ? invitation.role : "member";
                return (
                  <li
                    key={invitation.id}
                    className="flex flex-wrap items-start justify-between gap-3 px-5 py-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{invitation.email}</p>
                      <p className="mt-1 text-xs text-[var(--color-ink-subtle)]">
                        {ROLE_LABELS[role]} · invited by {invitation.invitedByName} · expires{" "}
                        {fmt.date(invitation.expiresAt)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {isEmailConfigured() ? (
                        <ConfirmForm
                          action={resendInvitationAction}
                          fields={{ invitationId: invitation.id }}
                          label="Re-send"
                          pendingLabel="Sending…"
                          confirm="Re-sending replaces the link, so the one already sent stops working. Continue?"
                        />
                      ) : null}
                      <ConfirmForm
                        action={revokeInvitationAction}
                        fields={{ invitationId: invitation.id }}
                        label="Revoke"
                        pendingLabel="Revoking…"
                        variant="danger"
                        confirm={`Revoke the invitation for ${invitation.email}? The link stops working immediately.`}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : null}

      {manages ? (
        <Card>
          <CardHeader
            title="Invite a teammate"
            description="They get an email with a link that only works for their address."
          />
          <InvitePanel emailConfigured={isEmailConfigured()} seatsLeft={seatsLeft} />
        </Card>
      ) : null}

      <Card>
        <CardHeader title="What each role can do" />
        <dl className="divide-y divide-[var(--color-line)]">
          {(["owner", "admin", "member"] as const).map((role) => (
            <div key={role} className="px-5 py-3">
              <dt className="text-sm font-medium">{ROLE_LABELS[role]}</dt>
              <dd className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
                {ROLE_DESCRIPTIONS[role]}
              </dd>
            </div>
          ))}
        </dl>
        <p className="border-t border-[var(--color-line)] px-5 py-3 text-xs text-[var(--color-ink-subtle)]">
          Quotations, customers, the catalog and follow-ups are open to everyone in the workspace.
          Roles govern who may change the workspace itself.
        </p>
      </Card>
    </>
  );
}
