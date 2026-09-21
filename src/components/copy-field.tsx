"use client";

import { useState } from "react";

/**
 * A read-only value with a copy button.
 *
 * The button reports what actually happened: browsers can refuse clipboard
 * access, and saying "Copied" when nothing was copied would send someone off
 * to paste an empty link.
 */
export function CopyField({
  value,
  label,
  helpText,
}: {
  value: string;
  label: string;
  helpText?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("failed");
    }
  };

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          value={value}
          aria-label={label}
          onFocus={(event) => event.currentTarget.select()}
          className="input font-mono text-xs"
        />
        <button type="button" onClick={copy} className="btn btn-secondary shrink-0">
          {state === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      {state === "failed" ? (
        <p className="mt-1 text-xs text-[var(--color-danger)]" role="alert">
          Your browser blocked clipboard access. Select the text above and copy it manually.
        </p>
      ) : null}
      {helpText && state !== "failed" ? (
        <p className="mt-1 text-xs text-[var(--color-ink-subtle)]">{helpText}</p>
      ) : null}
    </div>
  );
}
