import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { Alert } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { resolveInvitation } from "@/lib/invitations";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, isRole } from "@/lib/roles";
import { getSession } from "@/lib/session";
import { signOutAction } from "@/server/auth-actions";
import { AcceptInvitationForm, CreateAccountAndJoinForm } from "./forms";

export const metadata: Metadata = {
  title: "You have been invited",
  robots: { index: false, follow: false },
};

/**
 * The invitation landing page.
 *
 * It lives outside the `(auth)` group on purpose: that layout bounces a
 * signed-in visitor to the dashboard, and an invitation has to work whether
 * the person is signed in, signed in as somebody else, or has no account yet.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invitation = await resolveInvitation(token);

  if (!invitation) {
    return (
      <AuthShell>
        <h1 className="text-xl font-semibold tracking-tight">This invitation is not valid</h1>
        <div className="mt-4">
          <Alert tone="warning">
            It may have expired, been revoked, or already been used. Ask whoever invited you to
            send a new one.
          </Alert>
        </div>
        <Link href="/sign-in" className="btn btn-secondary mt-6 w-full">
          Sign in
        </Link>
      </AuthShell>
    );
  }

  const role = isRole(invitation.role) ? invitation.role : "member";
  const session = await getSession();

  const header = (
    <>
      <h1 className="text-xl font-semibold tracking-tight">
        Join {invitation.organizationName}
      </h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        {invitation.invitedByName} invited {invitation.email} to join as{" "}
        <span className="font-medium text-[var(--color-ink)]">{ROLE_LABELS[role]}</span>.
      </p>
      <p className="mt-3 rounded-lg bg-[var(--color-surface-muted)] px-3 py-2 text-xs text-[var(--color-ink-muted)]">
        {ROLE_DESCRIPTIONS[role]}
      </p>
    </>
  );

  // Signed in as somebody else: say so rather than silently attaching the
  // invitation to the wrong account.
  if (session && session.user.email.toLowerCase() !== invitation.email) {
    return (
      <AuthShell>
        {header}
        <div className="mt-6">
          <Alert tone="warning" title="You are signed in as someone else">
            This invitation was sent to {invitation.email}, but you are signed in as{" "}
            {session.user.email}. Sign out and use the link again.
          </Alert>
        </div>
        <form action={signOutAction} className="mt-4">
          <SubmitButton variant="secondary" className="w-full" pendingLabel="Signing out…">
            Sign out
          </SubmitButton>
        </form>
      </AuthShell>
    );
  }

  if (session) {
    return (
      <AuthShell>
        {header}
        <div className="mt-6">
          <AcceptInvitationForm token={token} workspaceName={invitation.organizationName} />
        </div>
      </AuthShell>
    );
  }

  if (invitation.existingUserId) {
    return (
      <AuthShell>
        {header}
        <p className="mt-6 text-sm text-[var(--color-ink-muted)]">
          {invitation.email} already has a QuoteFlow account. Sign in with it, then open this link
          again to accept.
        </p>
        <Link href="/sign-in" className="btn btn-primary mt-4 w-full">
          Sign in to accept
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      {header}
      <div className="mt-6">
        <CreateAccountAndJoinForm token={token} email={invitation.email} />
      </div>
    </AuthShell>
  );
}
