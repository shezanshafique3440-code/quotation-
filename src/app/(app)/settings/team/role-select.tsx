"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Alert } from "@/components/ui";
import { idleState } from "@/lib/action-state";
import { ROLES, ROLE_LABELS } from "@/lib/roles";
import { changeMemberRoleAction } from "@/server/member-actions";

/**
 * Role changes are an explicit submit rather than an on-change save: a
 * mis-click on a select should not silently hand someone ownership.
 */
export function RoleSelect({
  membershipId,
  role,
  allowOwner,
}: {
  membershipId: string;
  role: string;
  allowOwner: boolean;
}) {
  const [state, action] = useActionState(changeMemberRoleAction, idleState);
  const options = ROLES.filter((r) => r !== "owner" || allowOwner || r === role);

  return (
    <div>
      <form action={action} className="flex items-center gap-2">
        <input type="hidden" name="membershipId" value={membershipId} />
        <select name="role" className="input h-9 w-auto py-1 text-sm" defaultValue={role}>
          {options.map((option) => (
            <option key={option} value={option}>
              {ROLE_LABELS[option]}
            </option>
          ))}
        </select>
        <SubmitButton variant="ghost" pendingLabel="Saving…">
          Save
        </SubmitButton>
      </form>
      {state.status !== "idle" && state.message ? (
        <div className="mt-2">
          <Alert tone={state.status === "error" ? "danger" : "positive"}>{state.message}</Alert>
        </div>
      ) : null}
    </div>
  );
}
