"use client";

import { useActionState } from "react";
import { CopyField } from "@/components/copy-field";
import { SubmitButton } from "@/components/submit-button";
import { Alert } from "@/components/ui";
import { idleState } from "@/lib/action-state";
import { updateSharingAction } from "@/server/sharing-actions";

export function SharePanel({
  quotationId,
  enabled,
  shareUrl,
  isDraft,
  publicPagesEnabled,
  viewCount,
  firstViewedLabel,
  lastViewedLabel,
}: {
  quotationId: string;
  enabled: boolean;
  shareUrl: string | null;
  isDraft: boolean;
  publicPagesEnabled: boolean;
  viewCount: number;
  firstViewedLabel: string | null;
  lastViewedLabel: string | null;
}) {
  const [state, action] = useActionState(updateSharingAction, idleState);
  const returnedUrl = state.data?.url as string | undefined;
  const liveUrl = returnedUrl ?? shareUrl;

  // Reflect what the last action actually did, rather than re-rendering the
  // page and risking the returned link never reaching the screen.
  const isEnabled = state.status === "success" ? Boolean(returnedUrl) : enabled;

  if (!publicPagesEnabled) {
    return (
      <div className="px-5 py-4">
        <Alert tone="warning" title="Public quote pages are off">
          Turn them on in Business profile to share a link your customer can accept or decline.
        </Alert>
      </div>
    );
  }

  if (isDraft) {
    return (
      <div className="px-5 py-4">
        <Alert tone="brand" title="Not shareable yet">
          A draft cannot be accepted. Mark the quotation as sent and the share link becomes
          available.
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-5 py-4">
      {state.status !== "idle" && state.message ? (
        <Alert tone={state.status === "error" ? "danger" : "positive"}>{state.message}</Alert>
      ) : null}

      {isEnabled && liveUrl ? (
        <>
          <CopyField
            value={liveUrl}
            label="Public quotation link"
            helpText="Anyone with this link can view and respond to the quotation. It does not require a password."
          />

          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-[var(--color-ink-subtle)]">Opens</dt>
              <dd className="tabular-nums">{viewCount}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-ink-subtle)]">First opened</dt>
              <dd className="text-xs">{firstViewedLabel ?? "Not yet"}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-ink-subtle)]">Last opened</dt>
              <dd className="text-xs">{lastViewedLabel ?? "Not yet"}</dd>
            </div>
          </dl>

          <form action={action} className="flex flex-wrap gap-2">
            <input type="hidden" name="quotationId" value={quotationId} />
            <SubmitButton name="action" value="rotate" variant="secondary" pendingLabel="Replacing…">
              Replace link
            </SubmitButton>
            <SubmitButton name="action" value="disable" variant="danger" pendingLabel="Disabling…">
              Disable link
            </SubmitButton>
          </form>
          <p className="text-xs text-[var(--color-ink-subtle)]">
            Replacing the link immediately breaks the one you already sent.
          </p>
        </>
      ) : (
        <form action={action} className="space-y-3">
          <input type="hidden" name="quotationId" value={quotationId} />
          <p className="text-sm text-[var(--color-ink-muted)]">
            Create a link your customer can open to read the quotation and accept or decline it.
            Their response lands here and in the timeline.
          </p>
          <SubmitButton name="action" value="enable" pendingLabel="Creating link…">
            Create share link
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
