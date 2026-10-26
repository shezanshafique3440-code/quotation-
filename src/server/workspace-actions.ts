"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorState, isFrameworkError, toActionState, type ActionState } from "@/lib/action-state";
import { text } from "@/lib/form";
import { requireSession } from "@/lib/session";
import { switchWorkspace } from "@/lib/workspaces";

export async function switchWorkspaceAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    const organizationId = text(formData, "organizationId");
    if (!organizationId) return errorState("Choose a workspace.");

    await switchWorkspace(session, organizationId);
    revalidatePath("/", "layout");
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return toActionState(error);
  }

  // A record from the previous workspace may not exist in the new one.
  redirect("/dashboard");
}
