"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  className = "",
  formAction,
  name,
  value,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  className?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={`btn btn-${variant} ${className}`}
      formAction={formAction}
      name={name}
      value={value}
      aria-busy={pending}
    >
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}
