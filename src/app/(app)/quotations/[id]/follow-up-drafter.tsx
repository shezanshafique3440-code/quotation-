"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Field } from "@/components/ui";
import { idleState } from "@/lib/action-state";
import { draftFollowUpAction } from "@/server/ai-actions";

export function FollowUpDrafter({
  quotationId,
  enabled,
}: {
  quotationId: string;
  enabled: boolean;
}) {
  const [state, action] = useActionState(draftFollowUpAction, idleState);
  const data = state.data as
    | { whatsappMessage?: string; emailSubject?: string; emailBody?: string; model?: string }
    | undefined;

  if (!enabled) {
    return (
      <div className="px-5 py-4">
        <Alert tone="warning" title="AI drafting is switched off">
          Set AI_PROVIDER and ANTHROPIC_API_KEY on the server to draft follow-ups here. Until then,
          write the message yourself.
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-5 py-4">
      {state.status === "error" && state.message ? (
        <Alert tone="danger">{state.message}</Alert>
      ) : null}

      {state.status === "success" && data?.whatsappMessage ? (
        <div className="space-y-3">
          <Alert tone="positive" title="Draft ready">
            Written by {data.model ?? "the configured model"}. Nothing has been sent — copy it into
            WhatsApp or your email client yourself.
          </Alert>

          <div>
            <p className="label">WhatsApp</p>
            <textarea
              readOnly
              className="input min-h-32 font-mono text-xs"
              value={data.whatsappMessage}
              aria-label="Drafted WhatsApp follow-up"
            />
          </div>

          {data.emailSubject ? (
            <div>
              <p className="label">Email subject</p>
              <input readOnly className="input text-sm" value={data.emailSubject} />
            </div>
          ) : null}

          {data.emailBody ? (
            <div>
              <p className="label">Email body</p>
              <textarea
                readOnly
                className="input min-h-40 font-mono text-xs"
                value={data.emailBody}
                aria-label="Drafted email follow-up"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <form action={action} className="space-y-3">
        <input type="hidden" name="quotationId" value={quotationId} />
        <Field
          label="Anything to mention?"
          htmlFor="instructions"
          hint="Optional. The draft never invents a price, a discount or a promise you have not made."
        >
          <input
            id="instructions"
            name="instructions"
            className="input"
            maxLength={1000}
            placeholder="Mention that the oak option is still available"
          />
        </Field>
        <SubmitButton variant="secondary" pendingLabel="Drafting…">
          {state.status === "success" ? "Draft another" : "Draft a follow-up"}
        </SubmitButton>
      </form>
    </div>
  );
}
