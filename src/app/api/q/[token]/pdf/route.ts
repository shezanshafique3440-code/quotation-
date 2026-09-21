import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { renderQuotationPdf } from "@/lib/pdf";
import { getQuotation } from "@/lib/quotations";
import { loadPublicQuotation } from "@/lib/sharing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The customer's own copy of the quotation, behind the same share token. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    await enforceRateLimit("pdfDownload", clientIp(request.headers));

    const record = await loadPublicQuotation(token);
    if (!record) {
      return NextResponse.json(
        { error: { code: "not_found", message: "This quotation is no longer available." } },
        { status: 404 },
      );
    }

    const quotation = await getQuotation(record.organizationId, record.id);
    const profile = await prisma.businessProfile.findUnique({
      where: { organizationId: record.organizationId },
    });

    const pdf = await renderQuotationPdf(quotation, {
      legalName: profile?.legalName ?? record.organization.name,
      email: profile?.email ?? null,
      phone: profile?.phone ?? null,
      website: profile?.website ?? null,
      addressLine1: profile?.addressLine1 ?? null,
      addressLine2: profile?.addressLine2 ?? null,
      city: profile?.city ?? null,
      postalCode: profile?.postalCode ?? null,
      country: profile?.country ?? null,
      taxId: profile?.taxId ?? null,
      locale: profile?.locale ?? "en-US",
      brandColor: profile?.brandColor ?? null,
    });

    return new NextResponse(pdf as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${quotation.number}.pdf"`,
        "cache-control": "private, no-store",
        // A quotation is not for search engines even when the link is public.
        "x-robots-tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
