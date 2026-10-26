"use client";

import { useActionState, useId } from "react";
import { idleState } from "@/lib/action-state";
import type { WorkspaceOption } from "@/lib/workspaces";
import { switchWorkspaceAction } from "@/server/workspace-actions";
import { SubmitButton } from "./submit-button";
import { Alert } from "./ui";

export function WorkspaceSwitcher({
  workspaces,
  currentOrganizationId,
}: {
  workspaces: WorkspaceOption[];
  currentOrganizationId: string;
}) {
  const id = useId();
  const [state, formAction, pending] = useActionState(switchWorkspaceAction, idleState);

  if (workspaces.length < 2) {
    return (
      <p className="mt-2 truncate text-xs text-[var(--color-ink-subtle)]">
        {workspaces.find((workspace) => workspace.id === currentOrganizationId)?.name}
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-3 space-y-2">
      <label htmlFor={id} className="label">Workspace</label>
      <select
        id={id}
        name="organizationId"
        className="input"
        defaultValue={currentOrganizationId}
        disabled={pending}
        required
      >
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name} · {workspace.role}
          </option>
        ))}
      </select>
      <SubmitButton variant="secondary" className="w-full" pendingLabel="Switching…">
        Switch workspace
      </SubmitButton>
      {state.status === "error" && state.message ? (
        <Alert tone="danger">{state.message}</Alert>
      ) : null}
    </form>
  );
}
