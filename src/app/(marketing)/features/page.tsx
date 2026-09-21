import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Features — quote-to-close in one place",
  description:
    "Shareable quotation pages, online accept and decline, typed e-signature, automatic follow-ups, reusable templates, multi-currency pricing and a customer portal.",
  alternates: { canonical: "/features" },
  openGraph: {
    title: "QuoteFlow AI features",
    description: "Everything between a customer's question and a signed acceptance.",
    type: "website",
    url: "/features",
  },
};

const SECTIONS = [
  {
    title: "Shareable quotation pages",
    body: "Every quotation gets a private link. Your customer opens a clean, branded page — your logo, your colour — reads the lines and terms, downloads the PDF, and responds. No account, no password, no attachment that gets lost in a thread.",
    points: [
      "Revoke or replace a link at any time; the old one stops working immediately",
      "Link-preview bots are excluded, so an “opened” event means a person really opened it",
      "The page is never indexed by search engines",
    ],
  },
  {
    title: "Accept, decline and sign",
    body: "The customer decides on the page. Acceptance is recorded against the quotation with a timestamp, and optionally a typed electronic signature with the signer's name, email and a one-way hash of their IP address.",
    points: [
      "Signature can be required per quotation or set as a workspace default",
      "A decision is final and cancels any pending follow-up automatically",
      "The acceptance record is printed on the PDF",
    ],
  },
  {
    title: "Expiry and automatic follow-ups",
    body: "Set a validity date and QuoteFlow schedules the chase for you. Quotations that lapse move to expired on their own, so your pipeline reflects reality rather than optimism.",
    points: [
      "“Valid until Friday” means end of Friday in your business timezone",
      "Follow-ups land at a sensible local hour, never at 3am",
      "AI can draft the follow-up message — you send it",
    ],
  },
  {
    title: "Templates and a catalog",
    body: "Save the quotation you send most often, with its lines, terms, validity and signature policy. Start the next one half-written.",
    points: [
      "Pre-priced lines from your product catalog",
      "Title patterns that fill in the customer and subject",
      "A default template for the quote you send every week",
    ],
  },
  {
    title: "Analytics that do not guess",
    body: "Sent, opened, accepted, declined, expired — plus how long customers take to decide. Value is reported exactly per currency, and converted to your reporting currency only where you recorded a rate.",
    points: [
      "Quotations without an exchange rate are excluded from converted totals, not estimated",
      "Opens come from real page views only",
      "Per-customer acceptance history",
    ],
  },
  {
    title: "A portal for repeat customers",
    body: "Give a customer one link that lists everything you have quoted them. They come back to it instead of asking you to resend.",
    points: [
      "Passwordless, revocable, and scoped to that one customer",
      "Drafts are never visible",
      "Branded with your logo and colour",
    ],
  },
];

export default function FeaturesPage() {
  return (
    <main className="mx-auto max-w-4xl px-5 py-12 sm:px-8 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        Everything between the question and the signature
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-[var(--color-ink-muted)]">
        QuoteFlow AI is built for small businesses that win work by quoting quickly and following
        up reliably — wherever in the world they invoice from.
      </p>

      <div className="mt-12 space-y-12">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2>
            <p className="mt-2 max-w-2xl text-[var(--color-ink-muted)]">{section.body}</p>
            <ul className="mt-4 space-y-2">
              {section.points.map((point) => (
                <li key={point} className="flex gap-2 text-sm text-[var(--color-ink-muted)]">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--color-brand)]" />
                  {point}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="mt-14 card p-6">
        <h2 className="text-lg font-semibold">What QuoteFlow does not do</h2>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          It does not send WhatsApp messages or emails for you — it writes the message and opens
          your own client, so nothing goes out that you have not read. AI drafts are drafts: they
          reprice every catalog line from your database and never invent a figure. And a plan only
          becomes Pro when a signature-verified payment webhook says so.
        </p>
        <Link href="/sign-up" className="btn btn-primary mt-5">
          Start free
        </Link>
      </section>
    </main>
  );
}
