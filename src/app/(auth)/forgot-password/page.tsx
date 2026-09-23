import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui";
import { isEmailConfigured } from "@/lib/env";
import { ForgotPasswordForm } from "./form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  const canSend = isEmailConfigured();

  return (
    <div className="card p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        We will email you a link that lets you choose a new one.
      </p>

      <div className="mt-6">
        {canSend ? (
          <ForgotPasswordForm />
        ) : (
          <Alert tone="warning" title="This deployment cannot send email">
            Password resets need an email provider, and none is configured here. Ask whoever
            administers this QuoteFlow to reset it for you.
          </Alert>
        )}
      </div>

      <p className="mt-6 text-sm text-[var(--color-ink-muted)]">
        Remembered it?{" "}
        <Link href="/sign-in" className="font-medium text-[var(--color-brand)] hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
