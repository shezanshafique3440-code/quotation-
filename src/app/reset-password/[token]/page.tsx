import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { Alert } from "@/components/ui";
import { resolveAuthToken } from "@/lib/auth-tokens";
import { ResetPasswordForm } from "./form";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await resolveAuthToken(token, "password_reset");

  if (!resolved) {
    return (
      <AuthShell>
        <h1 className="text-xl font-semibold tracking-tight">This link has expired</h1>
        <div className="mt-4">
          <Alert tone="warning">
            Reset links last one hour and can only be used once. This one is no longer valid —
            request a new one and use the newest email.
          </Alert>
        </div>
        <Link href="/forgot-password" className="btn btn-primary mt-6 w-full">
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="text-xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">For {resolved.user.email}.</p>
      <div className="mt-6">
        <ResetPasswordForm token={token} />
      </div>
    </AuthShell>
  );
}
