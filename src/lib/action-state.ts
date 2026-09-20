import { ZodError } from "zod";
import { AppError } from "./errors";
import { fieldErrors } from "./validation";

export interface ActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Opaque payload a successful action wants to hand back to the form. */
  data?: Record<string, unknown>;
}

export const idleState: ActionState = { status: "idle" };

export function successState(message: string, data?: Record<string, unknown>): ActionState {
  return data === undefined
    ? { status: "success", message }
    : { status: "success", message, data };
}

export function errorState(message: string, fields?: Record<string, string>): ActionState {
  return fields === undefined
    ? { status: "error", message }
    : { status: "error", message, fieldErrors: fields };
}

/**
 * Map a thrown error onto form state. Only `AppError` messages are surfaced;
 * anything else is logged server-side and reported generically so that internal
 * details never leak into the UI.
 */
export function toActionState(error: unknown): ActionState {
  if (error instanceof ZodError) {
    return errorState("Please fix the highlighted fields.", fieldErrors(error));
  }
  if (error instanceof AppError) {
    return errorState(error.message);
  }
  console.error("[action] unhandled error", error);
  return errorState("Something went wrong on our side. Please try again.");
}

/** Next's redirect() and notFound() work by throwing — never swallow those. */
export function isFrameworkError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    ((error as { digest: string }).digest.startsWith("NEXT_REDIRECT") ||
      (error as { digest: string }).digest === "NEXT_NOT_FOUND")
  );
}
