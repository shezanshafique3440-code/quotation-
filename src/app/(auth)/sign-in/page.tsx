import type { Metadata } from "next";
import Link from "next/link";
import { SignInForm } from "./form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const { reset } = await searchParams;

  return (
    <div className="card p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        Welcome back. Pick up where you left off.
      </p>
      <div className="mt-6">
        <SignInForm justReset={reset === "1"} />
      </div>
      <p className="mt-6 text-sm text-[var(--color-ink-muted)]">
        New here?{" "}
        <Link href="/sign-up" className="font-medium text-[var(--color-brand)] hover:underline">
          Create a workspace
        </Link>
      </p>
    </div>
  );
}
