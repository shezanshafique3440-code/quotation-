"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Alert } from "@/components/ui";
import { idleState, type ActionState } from "@/lib/action-state";

/**
 * A single-button form backed by a server action. Used for status changes and
 * destructive actions; `confirm` gates the submit in the browser, and the
 * server re-checks ownership regardless.
 */
export function ConfirmForm({
  action,
  fields,
  label,
  pendingLabel,
  confirm,
  variant = "secondary",
  showResult = true,
  className = "",
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  fields: Record<string, string>;
  label: string;
  pendingLabel?: string;
  confirm?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  showResult?: boolean;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, idleState);

  return (
    <div className={className}>
      <form
        action={formAction}
        onSubmit={(event) => {
          if (confirm && !window.confirm(confirm)) event.preventDefault();
        }}
      >
        {Object.entries(fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <SubmitButton variant={variant} pendingLabel={pendingLabel}>
          {label}
        </SubmitButton>
      </form>
      {showResult && state.status !== "idle" && state.message ? (
        <div className="mt-2">
          <Alert tone={state.status === "error" ? "danger" : "positive"}>{state.message}</Alert>
        </div>
      ) : null}
    </div>
  );
}
