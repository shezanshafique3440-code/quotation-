import type { Metadata } from "next";
import Link from "next/link";
import { PLAN_LIMITS } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Pricing — free to start, Pro when quoting is how you win",
  description:
    "QuoteFlow AI pricing. Free includes AI drafts, shareable quotation pages, PDF export and follow-ups. Pro removes the monthly limits.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "QuoteFlow AI pricing",
    description: "Free to start. Pro when quoting is how you win work.",
    type: "website",
    url: "/pricing",
  },
};

const ROWS: { label: string; free: string; pro: string }[] = [
  {
    label: "AI quotation drafts",
    free: `${PLAN_LIMITS.free.aiDraftsPerMonth} per month`,
    pro: "Unlimited",
  },
  {
    label: "Quotations",
    free: `${PLAN_LIMITS.free.quotationsPerMonth} per month`,
    pro: "Unlimited",
  },
  { label: "Catalog products", free: `${PLAN_LIMITS.free.products}`, pro: "Unlimited" },
  { label: "Team members", free: "1", pro: `Up to ${PLAN_LIMITS.pro.teamMembers}` },
  { label: "Shareable quotation pages", free: "Included", pro: "Included" },
  { label: "Accept / decline and e-signature", free: "Included", pro: "Included" },
  { label: "Customer portal", free: "Included", pro: "Included" },
  { label: "PDF export", free: "Included", pro: "Included" },
  { label: "Analytics and audit log", free: "Included", pro: "Included" },
  { label: "Custom branding on quotations", free: "—", pro: "Included" },
];

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-4xl px-5 py-12 sm:px-8 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Pricing</h1>
      <p className="mt-4 max-w-2xl text-lg text-[var(--color-ink-muted)]">
        Start on Free with no card. Everything that closes a deal — share links, acceptance,
        signatures, the portal — is on both plans; Pro removes the monthly limits.
      </p>

      <div className="mt-10 overflow-x-auto">
        <table className="w-full min-w-lg text-sm">
          <caption className="sr-only">Feature comparison between the Free and Pro plans</caption>
          <thead>
            <tr className="border-b border-[var(--color-line)] text-left">
              <th scope="col" className="py-3 font-medium text-[var(--color-ink-muted)]">
                What you get
              </th>
              <th scope="col" className="py-3 font-semibold">Free</th>
              <th scope="col" className="py-3 font-semibold text-[var(--color-brand-strong)]">Pro</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {ROWS.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="py-3 text-left font-normal">{row.label}</th>
                <td className="py-3 text-[var(--color-ink-muted)]">{row.free}</td>
                <td className="py-3">{row.pro}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/sign-up" className="btn btn-primary">
          Create your workspace
        </Link>
        <Link href="/features" className="btn btn-secondary">
          See the features
        </Link>
      </div>

      <p className="mt-8 max-w-2xl text-xs text-[var(--color-ink-subtle)]">
        Pro is billed through Stripe where the deployment has it configured. A workspace only
        becomes Pro once Stripe confirms the payment through a signed webhook — returning from the
        checkout page never grants it on its own. Self-hosted deployments can run either plan
        without a payment provider at all.
      </p>
    </main>
  );
}
