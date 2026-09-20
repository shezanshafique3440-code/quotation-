import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getSession()) redirect("/dashboard");

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="px-5 py-5 sm:px-8">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          QuoteFlow<span className="text-[var(--color-brand)]"> AI</span>
        </Link>
      </header>
      <div className="flex flex-1 items-center justify-center px-5 pb-16 sm:px-8">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </main>
  );
}
