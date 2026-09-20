import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatBp, formatDecimal } from "./money";
import type { QuotationWithRelations } from "./quotations";

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const INK = rgb(0.09, 0.1, 0.13);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.85, 0.87, 0.9);
const ACCENT = rgb(0.16, 0.36, 0.86);

export interface PdfBusiness {
  legalName: string;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
  taxId?: string | null;
  locale: string;
}

/**
 * pdf-lib's standard fonts are WinAnsi-encoded and throw on characters outside
 * that range. Replacing them keeps export working for every tenant instead of
 * failing on, say, a customer name in Arabic — the alternative would be an
 * export button that errors for some users with no explanation.
 */
function toWinAnsi(input: string): string {
  return input
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of toWinAnsi(text).split("\n")) {
    if (paragraph.trim() === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line !== "") out.push(line);
        // A single word longer than the column is hard-split so it cannot overflow.
        let rest = word;
        while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
          let cut = rest.length;
          while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut -= 1;
          out.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        line = rest;
      }
    }
    out.push(line);
  }
  return out;
}

function formatDate(date: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
}

function newPage(ctx: Ctx): void {
  ctx.page = ctx.doc.addPage([A4.width, A4.height]);
  ctx.y = A4.height - MARGIN;
}

function ensureSpace(ctx: Ctx, needed: number): void {
  if (ctx.y - needed < MARGIN + 40) newPage(ctx);
}

function drawText(
  ctx: Ctx,
  text: string,
  x: number,
  size: number,
  opts: { bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right"; width?: number } = {},
): void {
  const font = opts.bold ? ctx.bold : ctx.regular;
  const value = toWinAnsi(text);
  const drawX =
    opts.align === "right" && opts.width !== undefined
      ? x + opts.width - font.widthOfTextAtSize(value, size)
      : x;
  ctx.page.drawText(value, { x: drawX, y: ctx.y, size, font, color: opts.color ?? INK });
}

export async function renderQuotationPdf(
  quotation: QuotationWithRelations,
  business: PdfBusiness,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Quotation ${quotation.number}`);
  doc.setSubject(quotation.title);
  doc.setProducer("QuoteFlow AI");
  doc.setCreationDate(new Date());

  const ctx: Ctx = {
    doc,
    page: doc.addPage([A4.width, A4.height]),
    y: A4.height - MARGIN,
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  const contentWidth = A4.width - MARGIN * 2;

  // --- Header -------------------------------------------------------------
  drawText(ctx, business.legalName, MARGIN, 18, { bold: true });
  drawText(ctx, "QUOTATION", MARGIN, 18, { bold: true, align: "right", width: contentWidth, color: ACCENT });
  ctx.y -= 18;

  const businessLines = [
    [business.addressLine1, business.addressLine2].filter(Boolean).join(", "),
    [business.postalCode, business.city, business.country].filter(Boolean).join(" "),
    business.phone,
    business.email,
    business.website,
    business.taxId ? `Tax ID: ${business.taxId}` : null,
  ].filter((l): l is string => Boolean(l && l.trim()));

  const metaLines = [
    `No. ${quotation.number}`,
    `Issued ${formatDate(quotation.createdAt, business.locale)}`,
    quotation.validUntil ? `Valid until ${formatDate(quotation.validUntil, business.locale)}` : null,
    `Currency ${quotation.currency}`,
  ].filter((l): l is string => Boolean(l));

  const headerRows = Math.max(businessLines.length, metaLines.length);
  for (let i = 0; i < headerRows; i += 1) {
    if (businessLines[i]) drawText(ctx, businessLines[i]!, MARGIN, 9, { color: MUTED });
    if (metaLines[i]) {
      drawText(ctx, metaLines[i]!, MARGIN, 9, { color: MUTED, align: "right", width: contentWidth });
    }
    ctx.y -= 12;
  }

  ctx.y -= 14;
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: A4.width - MARGIN, y: ctx.y },
    thickness: 1,
    color: RULE,
  });
  ctx.y -= 24;

  // --- Recipient ----------------------------------------------------------
  drawText(ctx, "QUOTED TO", MARGIN, 8, { bold: true, color: MUTED });
  ctx.y -= 14;
  drawText(ctx, quotation.customer.name, MARGIN, 12, { bold: true });
  ctx.y -= 14;
  for (const line of [
    quotation.customer.company,
    quotation.customer.email,
    quotation.customer.phone,
  ].filter((l): l is string => Boolean(l))) {
    drawText(ctx, line, MARGIN, 9, { color: MUTED });
    ctx.y -= 12;
  }

  ctx.y -= 10;
  drawText(ctx, quotation.title, MARGIN, 13, { bold: true });
  ctx.y -= 24;

  // --- Items table --------------------------------------------------------
  const cols = {
    description: { x: MARGIN, width: contentWidth - 250 },
    qty: { x: MARGIN + contentWidth - 250, width: 60 },
    price: { x: MARGIN + contentWidth - 190, width: 80 },
    tax: { x: MARGIN + contentWidth - 110, width: 40 },
    total: { x: MARGIN + contentWidth - 70, width: 70 },
  };

  const drawTableHeader = () => {
    drawText(ctx, "DESCRIPTION", cols.description.x, 8, { bold: true, color: MUTED });
    drawText(ctx, "QTY", cols.qty.x, 8, { bold: true, color: MUTED, align: "right", width: cols.qty.width });
    drawText(ctx, "UNIT PRICE", cols.price.x, 8, { bold: true, color: MUTED, align: "right", width: cols.price.width });
    drawText(ctx, "TAX", cols.tax.x, 8, { bold: true, color: MUTED, align: "right", width: cols.tax.width });
    drawText(ctx, "AMOUNT", cols.total.x, 8, { bold: true, color: MUTED, align: "right", width: cols.total.width });
    ctx.y -= 8;
    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y },
      end: { x: A4.width - MARGIN, y: ctx.y },
      thickness: 0.75,
      color: RULE,
    });
    ctx.y -= 16;
  };

  drawTableHeader();

  for (const item of quotation.items) {
    const descLines = wrap(item.description, ctx.regular, 10, cols.description.width - 8);
    ensureSpace(ctx, descLines.length * 13 + 12);
    if (ctx.y === A4.height - MARGIN) drawTableHeader();

    const qty = Number.isInteger(item.quantity) ? String(item.quantity) : item.quantity.toFixed(2);
    drawText(ctx, descLines[0] ?? "", cols.description.x, 10);
    drawText(ctx, `${qty} ${item.unit}`, cols.qty.x, 10, { align: "right", width: cols.qty.width });
    drawText(ctx, formatDecimal(item.unitPriceCents), cols.price.x, 10, { align: "right", width: cols.price.width });
    drawText(ctx, formatBp(item.taxRateBp), cols.tax.x, 10, { align: "right", width: cols.tax.width, color: MUTED });
    drawText(ctx, formatDecimal(item.lineTotalCents), cols.total.x, 10, { align: "right", width: cols.total.width });
    ctx.y -= 13;

    for (const extra of descLines.slice(1)) {
      drawText(ctx, extra, cols.description.x, 10);
      ctx.y -= 13;
    }
    ctx.y -= 5;
  }

  // --- Totals -------------------------------------------------------------
  ensureSpace(ctx, 90);
  ctx.y -= 6;
  ctx.page.drawLine({
    start: { x: MARGIN + contentWidth - 260, y: ctx.y },
    end: { x: A4.width - MARGIN, y: ctx.y },
    thickness: 0.75,
    color: RULE,
  });
  ctx.y -= 18;

  const totalRow = (label: string, value: string, bold = false, size = 10) => {
    drawText(ctx, label, MARGIN + contentWidth - 260, size, { bold, align: "right", width: 180 });
    drawText(ctx, value, cols.total.x, size, { bold, align: "right", width: cols.total.width });
    ctx.y -= bold ? 20 : 15;
  };

  totalRow("Subtotal", formatDecimal(quotation.subtotalCents));
  if (quotation.discountCents > 0) totalRow("Discount", `-${formatDecimal(quotation.discountCents)}`);
  if (quotation.taxCents > 0) totalRow("Tax", formatDecimal(quotation.taxCents));
  totalRow(`Total (${quotation.currency})`, formatDecimal(quotation.totalCents), true, 13);

  // --- Notes and terms ----------------------------------------------------
  for (const [heading, body] of [
    ["Notes", quotation.notes],
    ["Terms", quotation.terms],
  ] as const) {
    if (!body?.trim()) continue;
    const bodyLines = wrap(body.trim(), ctx.regular, 9, contentWidth);
    ensureSpace(ctx, bodyLines.length * 12 + 30);
    ctx.y -= 14;
    drawText(ctx, heading.toUpperCase(), MARGIN, 8, { bold: true, color: MUTED });
    ctx.y -= 14;
    for (const line of bodyLines) {
      drawText(ctx, line, MARGIN, 9);
      ctx.y -= 12;
    }
  }

  // --- Footer on every page ----------------------------------------------
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    page.drawText(toWinAnsi(`${business.legalName} — quotation ${quotation.number}`), {
      x: MARGIN,
      y: MARGIN - 16,
      size: 8,
      font: ctx.regular,
      color: MUTED,
    });
    const label = `Page ${index + 1} of ${pages.length}`;
    page.drawText(label, {
      x: A4.width - MARGIN - ctx.regular.widthOfTextAtSize(label, 8),
      y: MARGIN - 16,
      size: 8,
      font: ctx.regular,
      color: MUTED,
    });
  });

  return doc.save();
}
