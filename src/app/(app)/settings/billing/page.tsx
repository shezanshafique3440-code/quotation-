import type { Metadata } from "next";
import { ConfirmForm } from "@/components/confirm-form";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { isAiConfigured, isBillingConfigured, isEmailConfigured } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { PLAN_LABELS, PLAN_LIMITS } from "@/lib/plans";
import { requireTenant } from "@/lib/tenant";
import { getUsage } from "@/lib/usage";
import { openBillingPortalAction, startCheckoutAction } from "@/server/billing-actions";

export const metadata: Metadata = { title: "Plan & usage" };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { checkout } = await searchParams;
  const { session, profile } = await requireTenant();

  const [usage, organization] = await Promise.all([
    getUsage(session.organizationId),
    prisma.organization.findUniqueOrThrow({
      where: { id: session.organizationId },
      select: { plan: true, planStatus: true, planRenewsAt: true, stripeCustomerId: true },
    }),
  ]);

  const billingEnabled = isBillingConfigured();
  const isPro = organization.plan === "pro";
  const canManage = session.role === "owner" || session.role === "admin";

  return (
    <>
      <PageHeader
        title="Plan & usage"
        description={`${profile.legalName} · ${PLAN_LABELS[isPro ? "pro" : "free"]} plan`}
      />

      {checkout === "complete" ? (
        <Alert tone="brand" title="Returned from Stripe">
          Your plan updates as soon as Stripe confirms the payment through our webhook. If this page
          still shows Free in a minute, refresh — nothing is granted until the payment is confirmed.
        </Alert>
      ) : null}
      {checkout === "cancelled" ? (
        <Alert tone="warning">Checkout was cancelled. Your plan has not changed.</Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Current plan"
          description={
            organization.planRenewsAt
              ? `Renews ${formatDate(organization.planRenewsAt, profile.locale)}`
              : undefined
          }
          action={<Badge tone={isPro ? "positive" : "neutral"}>{organization.planStatus}</Badge>}
        />
        <div className="space-y-4 px-5 py-4">
          <dl className="space-y-3 text-sm">
            <UsageRow
              label="AI drafts this month"
              used={usage.aiDraftsUsed}
              limit={usage.limits.aiDraftsPerMonth}
            />
            <UsageRow
              label="Quotations this month"
              used={usage.quotationsUsed}
              limit={usage.limits.quotationsPerMonth}
            />
            <UsageRow
              label="Active catalog products"
              used={usage.productsUsed}
              limit={usage.limits.products}
            />
            <UsageRow label="Team members" used={usage.teamMembers} limit={usage.limits.teamMembers} />
          </dl>
          <p className="text-xs text-[var(--color-ink-subtle)]">
            Monthly counters reset at the start of each UTC calendar month —{" "}
            {formatDate(usage.periodEnd, profile.locale)}.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title={isPro ? "Manage subscription" : "Upgrade to Pro"} />
        <div className="space-y-4 px-5 py-4">
          {!billingEnabled ? (
            <Alert tone="warning" title="Payments are not configured">
              This deployment has no payment provider set up, so upgrades are unavailable. Set{" "}
              <code>BILLING_PROVIDER=stripe</code>, <code>STRIPE_SECRET_KEY</code>,{" "}
              <code>STRIPE_PRICE_ID_PRO</code> and <code>STRIPE_WEBHOOK_SECRET</code> to enable them.
              Plans can also be changed directly in the database for self-hosted installs.
            </Alert>
          ) : !canManage ? (
            <Alert tone="warning">Only workspace owners and admins can change the plan.</Alert>
          ) : isPro ? (
            <>
              <p className="text-sm text-[var(--color-ink-muted)]">
                Update your payment method, see invoices or cancel in the Stripe billing portal.
              </p>
              <ConfirmForm
                action={openBillingPortalAction}
                fields={{}}
                label="Open billing portal"
                pendingLabel="Opening Stripe…"
              />
            </>
          ) : (
            <>
              <ul className="space-y-1.5 text-sm text-[var(--color-ink-muted)]">
                <li>Unlimited AI drafts and quotations</li>
                <li>Unlimited catalog products</li>
                <li>Up to {PLAN_LIMITS.pro.teamMembers} team members</li>
                <li>Custom branding on quotations</li>
              </ul>
              <ConfirmForm
                action={startCheckoutAction}
                fields={{}}
                label="Upgrade to Pro"
                pendingLabel="Opening Stripe…"
                variant="primary"
              />
              <p className="text-xs text-[var(--color-ink-subtle)]">
                You will be taken to Stripe. Your plan changes only after Stripe confirms the payment.
              </p>
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Integrations on this deployment" />
        <dl className="divide-y divide-[var(--color-line)] text-sm">
          <IntegrationRow
            label="AI drafting"
            enabled={isAiConfigured()}
            enabledHint="Inquiries can be turned into draft quotations."
            disabledHint="Set AI_PROVIDER and ANTHROPIC_API_KEY to enable."
          />
          <IntegrationRow
            label="Email"
            enabled={isEmailConfigured()}
            enabledHint="Quotations can be emailed, and you are notified when customers respond."
            disabledHint="Set EMAIL_PROVIDER and EMAIL_FROM to enable."
          />
          <IntegrationRow
            label="Payments"
            enabled={billingEnabled}
            enabledHint="Stripe Checkout and the billing portal are available."
            disabledHint="Set BILLING_PROVIDER and the Stripe keys to enable."
          />
        </dl>
      </Card>
    </>
  );
}

function UsageRow({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit === null ? 0 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <dt className="text-[var(--color-ink-muted)]">{label}</dt>
        <dd className="tabular-nums">{limit === null ? `${used} · unlimited` : `${used} / ${limit}`}</dd>
      </div>
      {limit !== null ? (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
          <div
            className={`h-full rounded-full ${pct >= 100 ? "bg-[var(--color-danger)]" : "bg-[var(--color-brand)]"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

function IntegrationRow({
  label,
  enabled,
  enabledHint,
  disabledHint,
}: {
  label: string;
  enabled: boolean;
  enabledHint: string;
  disabledHint: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <div>
        <dt className="font-medium">{label}</dt>
        <dd className="text-xs text-[var(--color-ink-muted)]">
          {enabled ? enabledHint : disabledHint}
        </dd>
      </div>
      <Badge tone={enabled ? "positive" : "neutral"}>{enabled ? "Enabled" : "Not configured"}</Badge>
    </div>
  );
}
