import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PLAN_LIMITS } from "@/lib/plans";

export const metadata: Metadata = {
  title: "QuoteFlow AI — quote-to-close for small businesses",
  description:
    "Capture inquiries, draft quotations with AI, send a link your customer can accept or decline, and never lose a follow-up. Multi-currency, timezone-aware, built for small teams worldwide.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "QuoteFlow AI — quote-to-close for small businesses",
    description:
      "From “can you give me a price?” to a signed acceptance, without a CRM.",
    type: "website",
    url: "/",
  },
};

const FEATURES = [
  {
    title: "Inquiries in one inbox",
    body: "Log every WhatsApp, phone and walk-in request against a customer so nothing lives in your head.",
  },
  {
    title: "AI drafts you actually edit",
    body: "Claude turns an inquiry into a priced draft using your own catalog. Every line stays editable before it goes out.",
  },
  {
    title: "WhatsApp-ready messages",
    body: "Get the exact text plus a click-to-chat link that opens your own WhatsApp. Nothing is sent behind your back.",
  },
  {
    title: "Status you can trust",
    body: "Draft, sent, accepted, rejected, expired — with follow-up reminders so quiet quotes get chased.",
  },
  {
    title: "Clean PDF export",
    body: "A typeset A4 quotation with your business details, tax breakdown and terms. One click, no template wrangling.",
  },
  {
    title: "Accept or decline, online",
    body: "Send a link. Your customer reads the quotation, accepts or declines it, and optionally signs — you see the decision the moment it happens.",
  },
  {
    title: "Analytics you can trust",
    body: "Sent, opened, accepted, declined, expired. Opens come from real page views, never from an assumption that a sent quote was read.",
  },
  {
    title: "Multi-currency and timezone-aware",
    body: "Quote in 45 currencies with the correct minor units, and let “valid until Friday” mean Friday where your business actually is.",
  },
  {
    title: "Your data, scoped",
    body: "Every record is tied to your workspace and checked on every request. Sessions are hashed, never stored raw.",
  },
];

export default async function LandingPage() {
  if (await getSession()) redirect("/dashboard");

  return (
    <main>
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-10 sm:px-8 sm:pt-20">
        <p className="inline-flex rounded-full bg-[var(--color-brand-soft)] px-3 py-1 text-xs font-medium text-[var(--color-brand-strong)]">
          Built for small businesses that quote over WhatsApp
        </p>
        <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          From “can you give me a price?” to a sent quotation in two minutes.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-[var(--color-ink-muted)]">
          QuoteFlow AI captures the inquiry, drafts the quotation from your own catalog, writes the
          WhatsApp message, exports the PDF, and reminds you to follow up.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/sign-up" className="btn btn-primary">
            Create your workspace
          </Link>
          <Link href="/sign-in" className="btn btn-secondary">
            I already have one
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-20 sm:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="card p-5">
              <h2 className="text-sm font-semibold">{feature.title}</h2>
              <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-24 sm:px-8">
        <h2 className="text-2xl font-semibold tracking-tight">Plans</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="card p-6">
            <h3 className="text-sm font-semibold">Free</h3>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              Enough to run a small book of work.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-[var(--color-ink-muted)]">
              <li>{PLAN_LIMITS.free.aiDraftsPerMonth} AI drafts per month</li>
              <li>{PLAN_LIMITS.free.quotationsPerMonth} quotations per month</li>
              <li>{PLAN_LIMITS.free.products} catalog products</li>
              <li>PDF export and WhatsApp messages</li>
            </ul>
          </div>
          <div className="card border-[var(--color-brand)]/40 p-6">
            <h3 className="text-sm font-semibold text-[var(--color-brand-strong)]">Pro</h3>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              For when quoting is how you win work.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-[var(--color-ink-muted)]">
              <li>Unlimited AI drafts and quotations</li>
              <li>Unlimited catalog products</li>
              <li>Up to {PLAN_LIMITS.pro.teamMembers} team members</li>
              <li>Custom branding on quotations</li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
