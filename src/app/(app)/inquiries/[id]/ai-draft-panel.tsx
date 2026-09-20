"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Field } from "@/components/ui";
import { idleState } from "@/lib/action-state";
import { generateDraftAction } from "@/server/ai-actions";

interface RejectedLine {
  description: string;
  reason: string;
}

export function AiDraftPanel({
  inquiryId,
  enabled,
  disabledReason,
}: {
  inquiryId: string;
  enabled: boolean;
  disabledReason?: string;
}) {
  const [state, action] = useActionState(generateDraftAction, idleState);

  const data = state.data as
    | { quotationId?: string; quotationNumber?: string; summary?: string; rejected?: RejectedLine[]; model?: string }
    | undefined;

  if (!enabled) {
    return (
      <div className="px-5 py-4">
        <Alert tone="warning" title="AI drafting is switched off">
          {disabledReason ??
            "This deployment has no AI provider configured. You can still build the quotation by hand."}
        </Alert>
        <div className="mt-3">
          <Link href={`/quotations/new?inquiryId=${inquiryId}`} className="btn btn-primary">
            Build quotation manually
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 py-4">
      {state.status === "error" && state.message ? (
        <div className="mb-4">
          <Alert tone="danger">{state.message}</Alert>
        </div>
      ) : null}

      {state.status === "success" && data?.quotationId ? (
        <div className="mb-4 space-y-3">
          <Alert tone="positive" title={`Draft ${data.quotationNumber ?? ""} created`}>
            {data.summary ? <p>{data.summary}</p> : null}
            <p className="mt-1 text-xs opacity-80">
              Drafted by {data.model ?? "the configured model"}. Nothing has been sent — review every
              line before it goes to the customer.
            </p>
          </Alert>

          {data.rejected && data.rejected.length > 0 ? (
            <Alert tone="warning" title="Some suggested lines were dropped">
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
                {data.rejected.map((line, index) => (
                  <li key={`${line.description}-${index}`}>
                    <span className="font-medium">{line.description}</span> — {line.reason}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Link href={`/quotations/${data.quotationId}/edit`} className="btn btn-primary">
              Edit the draft
            </Link>
            <Link href={`/quotations/${data.quotationId}`} className="btn btn-secondary">
              Open quotation
            </Link>
          </div>
        </div>
      ) : null}

      <form action={action} className="space-y-4">
        <input type="hidden" name="inquiryId" value={inquiryId} />
        <Field
          label="Anything the draft should account for?"
          htmlFor="instructions"
          hint="Optional. For example: “include two site visits and a 10% trade discount”."
        >
          <textarea
            id="instructions"
            name="instructions"
            className="input min-h-20"
            maxLength={2000}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <SubmitButton pendingLabel="Drafting — this takes a few seconds…">
            Generate AI draft
          </SubmitButton>
          <Link href={`/quotations/new?inquiryId=${inquiryId}`} className="btn btn-secondary">
            Build manually instead
          </Link>
        </div>
      </form>
    </div>
  );
}
