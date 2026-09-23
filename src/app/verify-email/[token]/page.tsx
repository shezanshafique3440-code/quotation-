import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { Alert } from "@/components/ui";
import { resolveAuthToken } from "@/lib/auth-tokens";
import { ConfirmEmailForm } from "./form";

export const metadata: Metadata = {
  title: "Confirm your email address",
  robots: { index: false, follow: false },
};

export default async function VerifyEmailPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await resolveAuthToken(token, "email_verification");

  if (!resolved) {
    return (
      <AuthShell>
        <h1 className="text-xl font-semibold tracking-tight">This link has expired</h1>
        <div className="mt-4">
          <Alert tone="warning">
            Confirmation links last 48 hours and can only be used once. Sign in and use the banner
            at the top of the app to send yourself a new one.
          </Alert>
        </div>
        <Link href="/sign-in" className="btn btn-primary mt-6 w-full">
          Sign in
        </Link>
      </AuthShell>
    );
  }

  if (resolved.user.emailVerifiedAt) {
    return (
      <AuthShell>
        <h1 className="text-xl font-semibold tracking-tight">Already confirmed</h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          {resolved.user.email} is already confirmed. Nothing else to do.
        </p>
        <Link href="/dashboard" className="btn btn-primary mt-6 w-full">
          Go to your dashboard
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="text-xl font-semibold tracking-tight">Confirm your email address</h1>
      <div className="mt-6">
        <ConfirmEmailForm token={token} email={resolved.user.email} />
      </div>
    </AuthShell>
  );
}
