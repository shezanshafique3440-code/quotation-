# Existing app: capabilities and remaining configuration

The current scope is the existing QuoteFlow quotation application. Invoices,
stock management and automatic WhatsApp messaging are separate future modules.

## Available functionality

| Area | Current capability |
| --- | --- |
| Accounts | Sign-up/sign-in, hashed passwords and sessions, email verification, password reset and session revocation. |
| Workspaces | Tenant-scoped records and permissions, owner/admin/member roles, desktop/mobile workspace switching. |
| Customers and catalog | Customer history and contacts, editable products, SKU validation, active product limits, search and paginated customer records. |
| Inquiries | Customer-linked requests, status management, searchable history, pagination, manual quotation creation and optional AI drafts. |
| Quotations | Draft/edit, customer/inquiry ownership checks, catalog lines, currency-specific amounts, tax/discount totals, numbering, templates and guarded status transitions. |
| Customer response | Revocable share pages, accept/decline, typed signatures and customer portal links. |
| Documents | Private and shared PDF exports, branding, business-zone dates, pagination for long notes/terms and acceptance details. |
| Follow-ups | Scheduling, overdue/upcoming/closed pages, snooze/done/cancel, automatic cancellation when a quotation stops being sent. |
| Analytics | Status funnel, outcomes, per-currency totals and explicit exclusion of rates recorded for another reporting currency. |
| Teams | Invitations, manual link sharing when email is unavailable, replacement/revocation, roles and seat limits. Creating, replacing and accepting invitations is transactional. |
| Business settings | Locale/timezone, currency, tax, terms, portal policy, notification preferences and Pro branding controls. Existing branding is retained after a downgrade. |
| Plans and billing | Free/Pro limits, owner-only payment controls, Stripe checkout/portal and signed webhooks; current Stripe subscription-item renewal dates. |
| Activity and operations | Activity timelines, audit log, database-backed rate limits, database-aware health route and optional cron maintenance endpoint. |

## Gaps corrected in this pass

- Old quotations and inquiries were hidden by fixed list limits; search and
  pagination now expose all matching records without crossing workspaces.
- Pending follow-ups could be hidden behind closed records; groups now query
  and paginate independently.
- An edited quotation could reference another workspace's inquiry or a
  different customer's inquiry; both create and edit now validate ownership.
- Product and template prices assumed two decimal places. Catalog pricing now
  respects the currency scale and requires explicit prices for foreign-currency
  lines rather than inventing exchange rates.
- Changing the workspace currency could silently relabel catalog prices. Such
  a change is blocked while catalog records exist.
- Reopened quotations retained old signatures/decisions; the new lifecycle
  clears those fields while preserving the activity history. Status writes
  cannot overwrite a concurrent customer response.
- Invitation failures could lose the only usable link, consume a link without
  membership, or leave an orphan account. Transactional operations and
  recoverable copy-link controls cover those failures.
- Password-reset provider errors could disclose registered addresses. Public
  replies remain neutral when delivery fails.
- Missing workspace switching made later memberships hard to reach after
  sign-in. Membership-checked switching is now available in both layouts.
- Dates in several pages/PDFs used the server zone; they now use the business
  timezone. Long PDF notes and terms flow onto additional pages.
- Hidden form success notices also hid errors; errors now remain visible.
- Blank optional entries in `.env.example` prevented startup. Blank entries
  now mean unconfigured, while production secrets and enabled-provider
  requirements are still enforced.
- Fresh SQLite setup could fail before creating its file. `db:push` opens the
  database first; integration-test setup creates its isolated file explicitly.

## External setup still needed for optional features

| Feature | Requirement | Local status |
| --- | --- | --- |
| AI drafting | Anthropic provider, key and an available model. | Disabled; injected-client behavior tested. No live AI call claimed. |
| External email delivery | Resend or SMTP credentials plus a verified sender. | Local SMTP capture and actual verification/reset/quotation emails verified; external delivery remains unconfigured. |
| Paid subscriptions | Stripe key, Pro price, webhook secret and configured webhook endpoint. | Disabled; webhook/plan behavior tested with injected Stripe data. |
| Automatic expiry and digest dispatch | A `CRON_SECRET` and a schedule calling `/api/cron/reminders`. | Local key, authenticated runner and immediate/hourly watcher verified; hosted schedule remains unconfigured. |
| Public deployment | Hosting, HTTPS origin, production session key and an appropriate database. | Development SQLite prepared; no public deployment claimed. |

WhatsApp currently provides a click-to-chat link and message text, as described
in the application. It does not automatically send messages or ingest chats.

## Verification

- `npm test`: 46 suites, 544 tests passed, including real SQLite integration
  tests and component/server-action regressions.
- `npm run lint` and `npm run typecheck`: passed.
- `npm run build`: passed, including its lint/type checks.
- Fresh SQLite schema creation and repeated schema sync/seed: passed; repeated
  seed preserved the existing demo workspace.
- Production and development HTTP smoke: healthy database, actual sign-in action and session,
  authenticated application pages, private/shared PDFs and anonymous access
  controls passed. Both downloaded PDFs parsed with the expected document title.
- `npm run setup:local -- --mail`: locked installation, preserved local keys,
  schema sync and idempotent demo preparation verified.
- `npm run dev:local`: local app, SMTP inbox and maintenance watcher start
  together. `npm run maintenance` successfully authenticated to the real endpoint.
- `npm run test:local`: actual sign-up, captured verification/reset emails,
  account confirmation, password/session revocation, quotation SMTP delivery
  recording and emailed share page passed on repeated runs. Temporary account
  and workspace fixtures were removed; existing demos were retained.

Windows instructions are in [LOCAL_WINDOWS.md](LOCAL_WINDOWS.md). Commands use
Windows-safe child-process invocation and test database paths; runtime validation
so far was on the cloud Linux machine. Testing on the user's Windows computer
is the next step. Code is available on the `codex/windows-local-test` GitHub
branch for that review. The local Pro account is an explicit
development fixture and does not represent a Stripe payment.

These results cover this prepared instance and checkout. They do not establish
live third-party credentials, a hosted scheduler, deployment, publication or
restoration in a new cloud task.
