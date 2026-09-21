"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleState } from "@/lib/action-state";
import { respondToQuotationAction } from "@/server/public-actions";

export function RespondForm({
  token,
  requireSignature,
  defaultName,
  defaultEmail,
}: {
  token: string;
  requireSignature: boolean;
  defaultName: string;
  defaultEmail: string | null;
}) {
  const [state, action] = useActionState(respondToQuotationAction, idleState);
  const [decision, setDecision] = useState<"accept" | "reject" | null>(null);
  const errors = state.fieldErrors ?? {};

  if (state.status === "success") {
    return (
      <div
        className="rounded-xl border p-5"
        style={{ borderColor: "var(--brand-border)", background: "var(--brand-soft)" }}
        role="status"
      >
        <p className="text-sm font-semibold" style={{ color: "var(--brand-strong)" }}>
          {state.message}
        </p>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          You can close this page. A copy of the quotation stays available at this link.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="decision" value={decision ?? ""} />

      {state.status === "error" && state.message ? (
        <p
          className="rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]"
          role="alert"
        >
          {state.message}
        </p>
      ) : null}

      {decision === null ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            className="btn flex-1"
            style={{ background: "var(--brand)", color: "var(--brand-on)" }}
            onClick={() => setDecision("accept")}
          >
            Accept this quotation
          </button>
          <button
            type="button"
            className="btn btn-secondary flex-1"
            onClick={() => setDecision("reject")}
          >
            Decline
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm font-medium">
            {decision === "accept" ? "Accepting this quotation" : "Declining this quotation"}
          </p>

          <div>
            <label className="label" htmlFor="respondedByName">
              Your full name
            </label>
            <input
              id="respondedByName"
              name="respondedByName"
              className="input"
              required
              maxLength={160}
              defaultValue={defaultName}
              autoComplete="name"
            />
            {errors.respondedByName ? (
              <p className="mt-1 text-xs text-[var(--color-danger)]">{errors.respondedByName}</p>
            ) : null}
          </div>

          {decision === "accept" && requireSignature ? (
            <>
              <div>
                <label className="label" htmlFor="signatureName">
                  Type your name to sign
                </label>
                <input
                  id="signatureName"
                  name="signatureName"
                  className="input font-serif text-lg"
                  required
                  minLength={2}
                  maxLength={160}
                  placeholder="Your signature"
                />
                {errors.signatureName ? (
                  <p className="mt-1 text-xs text-[var(--color-danger)]">{errors.signatureName}</p>
                ) : null}
                <p className="mt-1 text-xs text-[var(--color-ink-subtle)]">
                  Typing your name here is your electronic signature. The date, your name and a
                  one-way hash of your IP address are recorded with the acceptance.
                </p>
              </div>

              <div>
                <label className="label" htmlFor="signatureEmail">
                  Your email (optional)
                </label>
                <input
                  id="signatureEmail"
                  name="signatureEmail"
                  type="email"
                  className="input"
                  defaultValue={defaultEmail ?? ""}
                  autoComplete="email"
                />
                {errors.signatureEmail ? (
                  <p className="mt-1 text-xs text-[var(--color-danger)]">{errors.signatureEmail}</p>
                ) : null}
              </div>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="agreed"
                  required
                  className="mt-0.5 size-4 rounded border-[var(--color-line)]"
                />
                <span>
                  I have read the quotation and its terms, and I am authorised to accept it on
                  behalf of the named customer.
                </span>
              </label>
            </>
          ) : null}

          {decision === "reject" ? (
            <div>
              <label className="label" htmlFor="rejectionReason">
                Anything the sender should know? (optional)
              </label>
              <textarea
                id="rejectionReason"
                name="rejectionReason"
                className="input min-h-24"
                maxLength={1000}
                placeholder="Too high, timing does not work, went with another supplier…"
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            <SubmitButton
              className="flex-1"
              variant={decision === "accept" ? "primary" : "secondary"}
              pendingLabel="Recording your response…"
            >
              {decision === "accept" ? "Confirm acceptance" : "Confirm decline"}
            </SubmitButton>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setDecision(null)}
            >
              Back
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
