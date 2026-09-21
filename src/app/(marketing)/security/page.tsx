import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Security — how QuoteFlow protects your quotations",
  description:
    "Tenant isolation, hashed sessions, revocable share links, rate limiting, an append-only audit log, and exactly what QuoteFlow stores about the people who open your quotes.",
  alternates: { canonical: "/security" },
  openGraph: {
    title: "QuoteFlow AI security",
    description: "How tenant isolation, share links and the audit log actually work.",
    type: "website",
    url: "/security",
  },
};

const TOPICS = [
  {
    title: "Tenant isolation",
    body: "Every record belongs to one workspace, and every read and write is filtered by it. Asking for a record that belongs to someone else returns a 404 — the same answer as a record that does not exist — so an id cannot be probed. Membership is re-checked on every request, so removing someone from a workspace takes effect immediately rather than when their session expires.",
  },
  {
    title: "Passwords and sessions",
    body: "Passwords are hashed with scrypt and a per-user salt, and compared in constant time. Sign-in gives the same answer for an unknown address and a wrong password, and still verifies a dummy hash when the account does not exist, so response time does not reveal which addresses are registered. The session cookie holds 256 bits of random token and is HttpOnly, SameSite=Lax and Secure in production; the database stores only a keyed hash of it, so a database dump yields no usable sessions.",
  },
  {
    title: "Share links and the portal",
    body: "A quotation share link authorises exactly one quotation, and only to read it and respond. It can be disabled or replaced at any moment, and replacing it breaks the old one instantly. Customer portal links are stored only as a keyed hash — the link itself exists once, in the moment you copy it — and issuing a new one revokes the previous.",
  },
  {
    title: "What we record about your customers",
    body: "When someone opens a quotation we record that it was opened, when, and a keyed one-way hash of their IP address. We do not store the address itself. Link-preview bots and repeat refreshes are excluded, so “opened” means a person actually looked at it. An electronic signature records the typed name, the timestamp, an optional email and the same IP hash.",
  },
  {
    title: "Rate limiting and abuse",
    body: "Sign-in, sign-up, AI generation, PDF downloads and every public endpoint are rate limited. Sign-in is limited per address and per account, so neither a noisy client nor a distributed attempt at one inbox gets unlimited tries. Counters live in the database, so the limit is shared across every running instance.",
  },
  {
    title: "Audit log",
    body: "Sign-ins and failed attempts, quotation changes, customer responses, share-link changes, plan changes and settings edits are all written to an append-only log you can read in the app. The application has no code path that edits or deletes a row.",
  },
  {
    title: "Payments",
    body: "QuoteFlow never sees a card number. Checkout happens on Stripe, and a workspace becomes Pro only when a signature-verified webhook says the payment succeeded — never from a browser redirect, which anyone could forge.",
  },
];

export default function SecurityPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Security</h1>
      <p className="mt-4 text-lg text-[var(--color-ink-muted)]">
        Quotations contain your prices and your customers. Here is what QuoteFlow does about that,
        in specifics rather than adjectives.
      </p>

      <div className="mt-12 space-y-10">
        {TOPICS.map((topic) => (
          <section key={topic.title}>
            <h2 className="text-lg font-semibold tracking-tight">{topic.title}</h2>
            <p className="mt-2 text-[var(--color-ink-muted)]">{topic.body}</p>
          </section>
        ))}
      </div>

      <section className="card mt-12 p-6">
        <h2 className="text-lg font-semibold">Running it yourself</h2>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          QuoteFlow refuses to start in production with a placeholder session secret, a non-HTTPS
          public URL, or Stripe enabled without a webhook secret — configurations that would look
          fine until the day they mattered.
        </p>
        <Link href="/sign-up" className="btn btn-primary mt-5">
          Create your workspace
        </Link>
      </section>
    </main>
  );
}
