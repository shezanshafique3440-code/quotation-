import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it } from "vitest";
import { renderQuotationPdf, type PdfBusiness } from "@/lib/pdf";
import { createQuotation, getQuotation } from "@/lib/quotations";
import { createWorkspace, quotationInput, resetDatabase, type Workspace } from "./helpers";

const business: PdfBusiness = {
  legalName: "Northline Joinery Ltd",
  email: "hello@northline.test",
  phone: "+441132960000",
  website: "https://northline.test",
  addressLine1: "12 Mill Lane",
  addressLine2: null,
  city: "Leeds",
  postalCode: "LS1 1AA",
  country: "United Kingdom",
  taxId: "GB123456789",
  locale: "en-GB",
};

/** Re-parse the output so the assertions run against a genuinely loadable PDF. */
async function parse(pdf: Uint8Array) {
  const doc = await PDFDocument.load(pdf);
  return { pageCount: doc.getPageCount(), title: doc.getTitle(), subject: doc.getSubject() };
}

async function quotationFor(workspace: Workspace, items?: unknown[]) {
  const created = await createQuotation({
    organizationId: workspace.organizationId,
    userId: workspace.userId,
    input: quotationInput(workspace, items ? { items } : {}),
    numberPrefix: "NJ",
  });
  return getQuotation(workspace.organizationId, created.id);
}

beforeEach(resetDatabase);

describe("renderQuotationPdf", () => {
  it("produces a real, non-trivial PDF document", async () => {
    const workspace = await createWorkspace();
    const pdf = await renderQuotationPdf(await quotationFor(workspace), business);

    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1_000);
    expect((await parse(pdf)).pageCount).toBe(1);
  });

  it("titles the document with the quotation number", async () => {
    const workspace = await createWorkspace();
    const quotation = await quotationFor(workspace);
    const parsed = await parse(await renderQuotationPdf(quotation, business));

    expect(parsed.title).toBe(`Quotation ${quotation.number}`);
    expect(parsed.subject).toBe(quotation.title);
  });

  it("flows onto extra pages for a long quotation", async () => {
    const workspace = await createWorkspace();
    const items = Array.from({ length: 45 }, (_, i) => ({
      description: `Line item number ${i + 1} with a reasonably long description that wraps`,
      quantity: 1,
      unit: "unit",
      unitPriceCents: 1_000 + i,
      taxRateBp: 1000,
    }));

    const pdf = await renderQuotationPdf(await quotationFor(workspace, items), business);
    expect((await parse(pdf)).pageCount).toBeGreaterThan(1);
  });

  it("does not throw on characters outside the standard font's encoding", async () => {
    const workspace = await createWorkspace();
    const items = [
      {
        description: "رفوف خشبية — 日本語 — ✓ emoji 🎉",
        quantity: 1,
        unit: "unit",
        unitPriceCents: 5_000,
        taxRateBp: 0,
      },
    ];

    const pdf = await renderQuotationPdf(await quotationFor(workspace, items), business);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
  });

  it("renders with a bare profile and no optional business details", async () => {
    const workspace = await createWorkspace();
    const pdf = await renderQuotationPdf(await quotationFor(workspace), {
      legalName: "Solo Trader",
      email: null,
      phone: null,
      website: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      postalCode: null,
      country: null,
      taxId: null,
      locale: "en-US",
    });

    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
  });
});
