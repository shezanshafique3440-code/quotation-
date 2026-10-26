import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionState } from "@/lib/action-state";
import { ConfirmForm } from "@/components/confirm-form";
import { TemplateForm } from "@/app/(app)/templates/template-form";
import { QuotationEditor } from "@/app/(app)/quotations/quotation-editor";

const actionState = vi.hoisted(() => ({ current: { status: "idle" } as ActionState }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useActionState: () => [actionState.current, () => undefined],
}));

beforeEach(() => { actionState.current = { status: "idle" }; });

describe("inline action feedback", () => {
  const render = () => renderToStaticMarkup(createElement(ConfirmForm, {
    action: async (): Promise<ActionState> => ({ status: "idle" }),
    fields: {},
    label: "Done",
    showResult: false,
  }));

  it("still shows errors when successful action messages are suppressed", () => {
    actionState.current = { status: "error", message: "This follow-up is already closed." };
    expect(render()).toContain("This follow-up is already closed.");
    expect(render()).toContain('role="alert"');
  });

  it("keeps successful action messages quiet when requested", () => {
    actionState.current = { status: "success", message: "Follow-up completed." };
    expect(render()).not.toContain("Follow-up completed.");
  });
});

describe("server-rendered editor field identifiers", () => {
  it("keeps quotation line labels stable across server requests", () => {
    const render = () => renderToStaticMarkup(createElement(QuotationEditor, {
      action: async (): Promise<ActionState> => ({ status: "idle" }),
      customers: [{ id: "customer", name: "Dana", company: null }],
      products: [],
      defaultCurrency: "USD",
      baseCurrency: "USD",
      defaultTaxRateBp: 0,
      locale: "en-US",
      submitLabel: "Save",
      cancelHref: "/quotations",
    }));
    const fields = (html: string) => [...html.matchAll(/(?:id|for)="([^"]*-line-0[^"]*)"/g)].map((m) => m[1]);
    const first = fields(render());
    expect(first.length).toBeGreaterThan(0);
    expect(fields(render())).toEqual(first);
  });

  it("renders templates with the workspace currency as the default", () => {
    const markup = renderToStaticMarkup(createElement(TemplateForm, {
      action: async (): Promise<ActionState> => ({ status: "idle" }),
      products: [],
      defaultCurrency: "JPY",
      defaultTaxRateBp: 0,
      defaultValidityDays: 14,
      submitLabel: "Save template",
    }));
    expect(markup).not.toContain("no currency conversion is applied");
    expect(markup).toContain("Workspace default");
  });
});
