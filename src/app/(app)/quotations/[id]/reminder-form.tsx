"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Field } from "@/components/ui";
import { idleState } from "@/lib/action-state";
import { REMINDER_CHANNELS, REMINDER_CHANNEL_LABELS } from "@/lib/constants";
import { createReminderAction } from "@/server/reminder-actions";

export function ReminderForm({
  quotationId,
  defaultDueAt,
}: {
  quotationId: string;
  defaultDueAt: string;
}) {
  const [state, action] = useActionState(createReminderAction, idleState);
  const errors = state.fieldErrors ?? {};
  const formKey = state.status === "success" ? (state.message ?? "done") : "form";

  return (
    <form action={action} className="space-y-4 px-5 py-4" noValidate key={formKey}>
      {state.status === "error" && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? (
        <Alert tone="positive">{state.message}</Alert>
      ) : null}

      <input type="hidden" name="quotationId" value={quotationId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Remind me on" htmlFor="dueAt" error={errors.dueAt}>
          <input
            id="dueAt"
            name="dueAt"
            type="datetime-local"
            className="input"
            required
            defaultValue={defaultDueAt}
          />
        </Field>
        <Field label="How" htmlFor="channel" error={errors.channel}>
          <select id="channel" name="channel" className="input" defaultValue="whatsapp">
            {REMINDER_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {REMINDER_CHANNEL_LABELS[channel]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Note" htmlFor="note" error={errors.note}>
        <input
          id="note"
          name="note"
          className="input"
          maxLength={1000}
          placeholder="Ask whether they want the oak or the birch option"
        />
      </Field>

      <SubmitButton pendingLabel="Scheduling…">Schedule follow-up</SubmitButton>
    </form>
  );
}
