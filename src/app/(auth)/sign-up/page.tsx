import type { Metadata } from "next";
import Link from "next/link";
import { SignUpForm } from "./form";

export const metadata: Metadata = { title: "Create your workspace" };

export default function SignUpPage() {
  return (
    <div className="card p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">Create your workspace</h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        Start on the Free plan. No card required.
      </p>
      <div className="mt-6">
        <SignUpForm />
      </div>
      <p className="mt-6 text-sm text-[var(--color-ink-muted)]">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-[var(--color-brand)] hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
