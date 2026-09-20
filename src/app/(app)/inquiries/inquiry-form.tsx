"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Field } from "@/components/ui";
import { idleState, type ActionState } from "@/lib/action-state";
import { INQUIRY_CHANNELS, INQUIRY_CHANNEL_LABELS } from "@/lib/constants";

export function InquiryForm({
  action,
  customers,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  customers: { id: string; name: string; company: string | null }[];
}) {
  const [state, formAction] = useActionState(action, idleState);
  const errors = state.fieldErrors ?? {};
  const formKey = state.status === "success" ? (state.message ?? "done") : "form";

  if (customers.length === 0) {
    return (
      <div className="px-5 py-6">
        <Alert tone="brand" title="Add a customer first">
          An inquiry always belongs to someone.{" "}
          <Link href="/customers" className="font-medium underline">
            Add a customer
          </Link>{" "}
          and come back.
        </Alert>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4 px-5 py-4" noValidate key={formKey}>
      {state.status === "error" && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? (
        <Alert tone="positive">{state.message}</Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer" htmlFor="customerId" error={errors.customerId}>
          <select id="customerId" name="customerId" className="input" required defaultValue="">
            <option value="" disabled>
              Select a customer
            </option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
                {customer.company ? ` — ${customer.company}` : ""}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Came in via" htmlFor="channel" error={errors.channel}>
          <select id="channel" name="channel" className="input" defaultValue="whatsapp">
            {INQUIRY_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {INQUIRY_CHANNEL_LABELS[channel]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Subject" htmlFor="subject" error={errors.subject}>
        <input
          id="subject"
          name="subject"
          className="input"
          required
          maxLength={160}
          placeholder="Kitchen shelving for a flat in Leeds"
        />
      </Field>

      <Field
        label="What they asked for"
        htmlFor="message"
        error={errors.message}
        hint="Paste the WhatsApp message or write down what they said. The more detail, the better the draft."
      >
        <textarea
          id="message"
          name="message"
          className="input min-h-32"
          required
          maxLength={8000}
        />
      </Field>

      <SubmitButton pendingLabel="Saving…">Log inquiry</SubmitButton>
    </form>
  );
}
