# QuoteFlow AI

A multi-tenant, quote-to-close SaaS for small businesses worldwide: capture the
inquiry, draft the quotation (optionally with AI, from your own catalog), send
your customer a link they can accept, decline or sign, export a PDF, track the
outcome, and chase the follow-up.

Built with Next.js 15 (App Router), TypeScript, Prisma and Tailwind CSS v4.

---

## What it does

| Area | Behaviour |
| --- | --- |
| **Authentication** | Email + password, scrypt hashing, database-backed sessions. The cookie holds a random token; only an HMAC of it is stored. |
| **Multi-tenancy** | Every record belongs to an `Organization`. Each request re-checks membership, and every query is scoped by `organizationId`. |
| **Business profile** | Name, address, tax ID, currency, locale, default tax rate, quote-number prefix, validity, default notes and terms. |
| **Product catalog** | Priced items with unit, SKU and tax rate. Feeds the quotation builder and the AI drafter. |
| **Inquiries** | Log a request against a customer, with channel and status (`new → quoted → won / archived`). |
| **AI drafts** | Claude turns an inquiry into an editable **draft** quotation. Catalog prices always override what the model wrote. |
| **Quotations** | Line items, per-line tax, document discount, server-computed totals, per-tenant numbering (`QT-2026-0001`). |
| **WhatsApp** | Generates the message text and a `wa.me` click-to-chat link. QuoteFlow never sends anything itself. |
| **PDF export** | A typeset A4 document with your business details, tax breakdown, notes and terms. |
| **Status tracking** | `draft → sent → accepted / rejected / expired`, with transitions enforced server-side. |
| **Shareable quote pages** | A private, branded link per quotation at `/q/<token>`, revocable and replaceable. Never indexed. |
| **Accept / decline online** | The customer responds on the page; the decision is recorded with a timestamp and source. |
| **E-signature** | Optional typed signature capturing the name, email, timestamp and a keyed hash of the signer's IP. Printed on the PDF. |
| **Expiry** | `valid until` means the end of that day in *your* timezone. Lapsed quotations expire on their own via the cron endpoint. |
| **Automatic follow-ups** | Sending a quotation schedules the chase, at a sensible local hour, cancelled automatically on a decision. |
| **Activity timeline** | Append-only per-quotation and per-customer history, and a workspace-wide audit log. |
| **Templates** | Reusable line sets with their own terms, validity, currency and signature policy. |
| **Multi-currency** | 45 currencies with correct minor units (¥1,200 is not ¥12.00). Optional per-quote FX rate for reporting. |
| **Timezone-aware** | Every date, deadline and reminder resolves in the workspace's IANA zone. |
| **Branding** | Logo, brand colour and portal copy applied to the share page, the portal and the PDF accent. |
| **Analytics** | Sent → opened → accepted funnel, outcomes by month, value per currency, time-to-decision. |
| **Customer portal** | One passwordless, revocable link listing everything you have quoted a customer. |
| **Rate limiting** | Database-backed fixed windows on sign-in, sign-up, AI, PDF and every public endpoint. |
| **Follow-ups** | Reminders per quotation, due/overdue views, snooze, complete, cancel. |
| **Plans & limits** | Free and Pro, metered per UTC calendar month and enforced before the work is done. |

### Things this app deliberately does *not* fake

- **It does not send WhatsApp messages.** It writes the text and opens your own
  WhatsApp with it pre-filled. Marking a quotation "sent" is a separate action.
- **It does not pretend AI works when it is not configured.** With no API key the
  AI panel says so and points you at the manual builder.
- **It does not grant Pro from a browser redirect.** The plan changes only when a
  signature-verified Stripe webhook arrives. Returning from Checkout says the
  plan updates once payment is confirmed — nothing more.
- **It does not claim to deliver reminders.** `/api/cron/reminders` expires stale
  quotations and *returns* the due follow-ups for an external notifier.
- **AI prices are not trusted.** Any line referencing a catalog product is
  repriced from the database; lines it cannot validate are dropped and reported.
  The follow-up drafter is instructed never to state a price, offer a discount,
  or claim an action was taken — and it produces text only.
- **"Opened" means opened.** View tracking runs from the browser, not the server
  render, and excludes link-preview bots and refreshes. A quotation you sent as
  an email attachment is never reported as opened, because we cannot know.
- **Cross-currency totals are not estimated.** Analytics report each currency
  exactly. A converted total only includes quotations that carry a recorded
  rate, and says how many were excluded.

---

## Getting started

```bash
npm install
cp .env.example .env          # then set SESSION_SECRET
npm run db:generate
npm run db:push
npm run db:seed               # optional demo workspace
npm run dev
```

The seed creates `owner@northline.test` / `northline-demo-2026` with a catalog,
a customer, an inquiry, a sent quotation and a pending follow-up.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Vitest suite (unit + database integration) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:push` / `db:seed` | Sync the schema / load demo data |

---

## Configuration

Everything optional degrades to a *disabled* feature, never a fake one. See
`.env.example` for the full list.

**Required**

- `DATABASE_URL` — SQLite by default (`file:./dev.db`).
- `SESSION_SECRET` — at least 32 characters; required in production. It keys the
  HMAC used to fingerprint session tokens.
- `APP_URL` — public origin, used for Stripe redirects.

**AI drafting (optional)**

- `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `AI_MODEL` (default
  `claude-opus-5`), `AI_MAX_OUTPUT_TOKENS`.
- Left at `none`, the app runs fine and quotations are written by hand.

**Payments (optional)**

- `BILLING_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID_PRO`,
  `STRIPE_WEBHOOK_SECRET`.
- Point the Stripe webhook at `POST /api/stripe/webhook` and subscribe to
  `checkout.session.completed` and the `customer.subscription.*` events.

**Request handling**

- `TRUST_PROXY_HEADERS` (default `true`) — whether `x-forwarded-for` comes from
  a trusted proxy. When `false`, every caller shares one rate-limit bucket
  rather than being able to mint a fresh one by spoofing the header.
- `PUBLIC_PAGES_ENABLED` (default `true`) — fleet-wide kill switch for share
  links and portals.
- `ALLOW_INSECURE_LOCAL` (default `false`) — lets a production build run against
  `http://localhost` for smoke-testing. It only relaxes the loopback case.

**Scheduled maintenance (optional)**

- `CRON_SECRET` — bearer token for `/api/cron/reminders`. Call it on a schedule
  (every 15 minutes is plenty). It expires lapsed quotations, prunes rate-limit
  rows and *returns* the follow-ups now due — it delivers nothing, and the
  response body says `"delivered": false`.

### Switching to PostgreSQL

The schema is deliberately portable: no database enums, no `Decimal` columns,
and all money stored as integer minor units. Change the provider and point
`DATABASE_URL` at your server:

```prisma
datasource db {
  provider = "postgresql"   // was "sqlite"
  url      = env("DATABASE_URL")
}
```

```bash
npm run db:push
```

---

## Plan limits

| | Free | Pro |
| --- | --- | --- |
| AI drafts / month | 10 | unlimited |
| Quotations / month | 20 | unlimited |
| Active catalog products | 25 | unlimited |
| Team members | 1 | 10 |
| Custom branding | — | yes |

Limits are checked *before* the work starts, so an over-limit request never
spends a model call it cannot save. Counters reset at the first instant of each
UTC calendar month.

---

## Architecture

```
src/
  app/
    (auth)/            sign-in, sign-up
    (app)/             dashboard, inquiries, quotations, customers,
                       products, reminders, settings
    api/               pdf export, stripe webhook, cron, health
  components/          shared UI primitives
  lib/                 domain logic — money, plans, usage, quotations,
                       ai, pdf, whatsapp, billing, validation, session
  server/              "use server" actions (thin: parse → authorise → call lib)
prisma/                schema and seed
tests/                 vitest suite
```

Mutations go through **server actions** that parse with zod, authorise against
the session, and delegate to `src/lib`. Route handlers are used only where a
non-HTML response is needed (PDF, webhook, cron, health).

### Money

All amounts are integer cents; tax rates are basis points (`1250` = 12.50%). A
document discount is spread proportionally across lines *before* tax, and
rounding happens once per line, so the printed lines always add up to the
printed total.

### Routing notes

Loading skeletons live on individual leaf routes, never on the `(app)` group and
never on a segment with dynamic children. A `loading.tsx` makes Next stream the
response, which commits the HTTP status before the page runs — so a `notFound()`
raised by a tenant-ownership check would render the 404 page with a `200`. The
boundary also covers nested segments, so a skeleton on `/quotations` would
silently do the same to `/quotations/[id]`. Routes that can legitimately 404 are
therefore left un-streamed.

Server actions whose *returned data* is the only copy of something — the portal
link, a freshly minted share link — deliberately skip `revalidatePath` on the
current route. Revalidating re-renders the server tree mid-action, which can
race with `useActionState` and drop the result before it reaches the screen.
Those panels derive their state from the action result instead.

### Security

- Passwords: scrypt (N=16384, r=8, p=1) with a per-user salt and constant-time
  comparison. Sign-in returns one message for both unknown email and wrong
  password, and verifies a dummy hash when the user is missing so response time
  does not leak which addresses are registered.
- Sessions: 32 bytes of entropy in an `HttpOnly`, `SameSite=Lax` cookie
  (`Secure` in production). The database stores only an HMAC of the token, so a
  database leak yields no usable sessions. Membership is re-checked per request,
  so removing a user takes effect immediately.
- Tenancy: reads and writes are filtered by `organizationId`; a cross-tenant id
  returns 404 rather than disclosing existence.
- Share links: a token authorises exactly one quotation, to read and respond
  only. Disabling or replacing it takes effect immediately. Portal links are
  stored only as a keyed hash, so the link exists once — in the moment it is
  copied — and issuing a new one revokes the previous.
- Rate limiting: fixed windows in the database, shared across instances. Sign-in
  is limited per address *and* per account.
- Audit log: append-only. Client IPs are stored as a keyed one-way hash, never
  in the clear. The application has no code path that edits or deletes a row.
- Startup: the server refuses to boot in production with a placeholder session
  secret, a non-HTTPS public URL, or Stripe enabled without a webhook secret.
- Errors: only `AppError` messages reach the client; anything else is logged
  server-side and reported generically.

---

## Tests

```bash
npm test
```

300+ tests across 26 files. Unit tests cover the money engine, the currency
registry and its minor units, timezone arithmetic across DST, plan metering,
validation schemas, password hashing, branding contrast, WhatsApp rendering,
form parsing, request/bot classification and the AI-draft mapping.

Integration tests run against a real SQLite database created from the Prisma
schema and cover registration, authentication, sessions, quotation numbering,
tenant isolation, usage limits, Stripe webhook handling, PDF generation, the
share-link lifecycle, customer responses and signatures, portal links, template
CRUD, automatic follow-ups, quote expiry, rate limiting, the activity log and
analytics.

The AI and Stripe clients are injected in tests, so the suite never makes a
network call.
