import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import {
  applyTemplate,
  createTemplate,
  deleteTemplate,
  getTemplate,
  updateTemplate,
  type TemplateInput,
} from "@/lib/templates";
import { createWorkspace, resetDatabase, type Workspace } from "./helpers";

beforeEach(resetDatabase);

function templateInput(overrides: Partial<TemplateInput> = {}): TemplateInput {
  return {
    name: "Standard install",
    validityDays: 21,
    requireSignature: false,
    isDefault: false,
    titlePattern: "{customer} — {subject}",
    notes: "Lead time 3 weeks.",
    terms: "50% deposit.",
    items: [
      { description: "Survey", quantity: 1, unit: "visit", unitPriceCents: 9_500, taxRateBp: 2000 },
      { description: "Install", quantity: 8, unit: "hour", unitPriceCents: 4_800, taxRateBp: 2000 },
    ],
    ...overrides,
  };
}

describe("createTemplate", () => {
  it("stores the template with ordered lines", async () => {
    const workspace = await createWorkspace();
    const template = await createTemplate(workspace.organizationId, templateInput());

    expect(template.name).toBe("Standard install");
    expect(template.items).toHaveLength(2);
    expect(template.items[0]!.position).toBe(0);
    expect(template.items[1]!.description).toBe("Install");
  });

  it("rejects a duplicate name inside one workspace but allows it across workspaces", async () => {
    const mine = await createWorkspace();
    const theirs = await createWorkspace();

    await createTemplate(mine.organizationId, templateInput());
    await expect(createTemplate(mine.organizationId, templateInput())).rejects.toMatchObject({
      code: "duplicate_name",
    });
    await expect(createTemplate(theirs.organizationId, templateInput())).resolves.toBeTruthy();
  });

  it("refuses a line referencing another workspace's product", async () => {
    const mine = await createWorkspace();
    const theirs = await createWorkspace();

    await expect(
      createTemplate(
        mine.organizationId,
        templateInput({
          items: [
            {
              productId: theirs.productId,
              description: "Borrowed",
              quantity: 1,
              unit: "unit",
              unitPriceCents: 100,
              taxRateBp: 0,
            },
          ],
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    expect(await prisma.quotationTemplate.count()).toBe(0);
  });

  it("keeps at most one default per workspace", async () => {
    const workspace = await createWorkspace();
    const first = await createTemplate(workspace.organizationId, templateInput({ isDefault: true }));
    const second = await createTemplate(
      workspace.organizationId,
      templateInput({ name: "Rush job", isDefault: true }),
    );

    const defaults = await prisma.quotationTemplate.findMany({
      where: { organizationId: workspace.organizationId, isDefault: true },
      select: { id: true },
    });
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.id).toBe(second.id);
    expect((await getTemplate(workspace.organizationId, first.id)).isDefault).toBe(false);
  });
});

describe("updateTemplate", () => {
  it("replaces the lines rather than appending", async () => {
    const workspace = await createWorkspace();
    const template = await createTemplate(workspace.organizationId, templateInput());

    const updated = await updateTemplate(
      workspace.organizationId,
      template.id,
      templateInput({
        name: "Standard install",
        items: [
          { description: "Only line", quantity: 2, unit: "unit", unitPriceCents: 500, taxRateBp: 0 },
        ],
      }),
    );

    expect(updated.items).toHaveLength(1);
    expect(await prisma.quotationTemplateItem.count({ where: { templateId: template.id } })).toBe(1);
  });

  it("does not clear the default flag on itself when re-saved as default", async () => {
    const workspace = await createWorkspace();
    const template = await createTemplate(workspace.organizationId, templateInput({ isDefault: true }));

    const updated = await updateTemplate(
      workspace.organizationId,
      template.id,
      templateInput({ isDefault: true }),
    );
    expect(updated.isDefault).toBe(true);
  });

  it("refuses another workspace's template", async () => {
    const mine = await createWorkspace();
    const theirs = await createWorkspace();
    const template = await createTemplate(theirs.organizationId, templateInput());

    await expect(
      updateTemplate(mine.organizationId, template.id, templateInput()),
    ).rejects.toThrow(NotFoundError);
    await expect(getTemplate(mine.organizationId, template.id)).rejects.toThrow(NotFoundError);
  });
});

describe("deleteTemplate", () => {
  it("removes the template and its lines, and leaves quotations alone", async () => {
    const workspace = await createWorkspace();
    const template = await createTemplate(workspace.organizationId, templateInput());
    const { createQuotation } = await import("@/lib/quotations");
    const { quotationInput } = await import("./helpers");

    const quotation = await createQuotation({
      organizationId: workspace.organizationId,
      userId: workspace.userId,
      input: quotationInput(workspace, { templateId: template.id }),
      numberPrefix: "QT",
    });

    await deleteTemplate(workspace.organizationId, template.id);

    expect(await prisma.quotationTemplateItem.count({ where: { templateId: template.id } })).toBe(0);
    const kept = await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } });
    expect(kept.templateId).toBeNull();
    expect(kept.totalCents).toBe(quotation.totalCents);
  });

  it("refuses another workspace's template", async () => {
    const mine = await createWorkspace();
    const theirs = await createWorkspace();
    const template = await createTemplate(theirs.organizationId, templateInput());

    await expect(deleteTemplate(mine.organizationId, template.id)).rejects.toThrow(NotFoundError);
    expect(await prisma.quotationTemplate.count()).toBe(1);
  });
});

describe("applyTemplate", () => {
  const now = new Date("2026-04-01T09:00:00Z");

  async function fixture(workspace: Workspace, overrides: Partial<TemplateInput> = {}) {
    return createTemplate(workspace.organizationId, templateInput(overrides));
  }

  it("fills the title pattern from the context", async () => {
    const workspace = await createWorkspace();
    const template = await fixture(workspace);

    const input = applyTemplate(template, {
      customerId: workspace.customerId,
      customerName: "Dana Whitfield",
      inquiryId: workspace.inquiryId,
      inquirySubject: "Alcove shelving",
      fallbackCurrency: "USD",
      timezone: "UTC",
      now,
    });

    expect(input.title).toBe("Dana Whitfield — Alcove shelving");
    expect(input.customerId).toBe(workspace.customerId);
    expect(input.inquiryId).toBe(workspace.inquiryId);
    expect(input.items).toHaveLength(2);
    expect(input.notes).toBe("Lead time 3 weeks.");
  });

  it("falls back to the template name when there is no inquiry subject", async () => {
    const workspace = await createWorkspace();
    const template = await fixture(workspace, { titlePattern: "{subject}" });

    const input = applyTemplate(template, {
      customerId: workspace.customerId,
      customerName: "Dana",
      fallbackCurrency: "USD",
      timezone: "UTC",
      now,
    });
    expect(input.title).toBe("Standard install");
  });

  it("sets the validity to the end of the local day, the template's days out", async () => {
    const workspace = await createWorkspace();
    const template = await fixture(workspace, { validityDays: 21 });

    const berlin = applyTemplate(template, {
      customerId: workspace.customerId,
      customerName: "Dana",
      fallbackCurrency: "EUR",
      timezone: "Europe/Berlin",
      now,
    });
    // 1 April + 21 days = 22 April, end of day CEST (UTC+2).
    expect(berlin.validUntil?.toISOString()).toBe("2026-04-22T21:59:59.999Z");
  });

  it("uses the template currency when set and the workspace currency otherwise", async () => {
    const workspace = await createWorkspace();
    const plain = await fixture(workspace);
    const priced = await fixture(workspace, { name: "Euro job", currency: "EUR" });

    const context = {
      customerId: workspace.customerId,
      customerName: "Dana",
      fallbackCurrency: "GBP",
      timezone: "UTC",
      now,
    };

    expect(applyTemplate(plain, context).currency).toBe("GBP");
    expect(applyTemplate(priced, context).currency).toBe("EUR");
  });

  it("produces input the quotation service accepts end to end", async () => {
    const workspace = await createWorkspace();
    const template = await fixture(workspace);
    const { createQuotation } = await import("@/lib/quotations");

    const input = applyTemplate(template, {
      customerId: workspace.customerId,
      customerName: "Dana",
      fallbackCurrency: "USD",
      timezone: "UTC",
      now,
    });

    const quotation = await createQuotation({
      organizationId: workspace.organizationId,
      userId: workspace.userId,
      input: { ...input, templateId: template.id },
      numberPrefix: "QT",
    });

    // 1 × 9500 + 8 × 4800 = 47_900, plus 20% tax.
    expect(quotation.subtotalCents).toBe(47_900);
    expect(quotation.taxCents).toBe(9_580);
    expect(quotation.templateId).toBe(template.id);
  });
});
