import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { renderQuotationPdf } from "@/lib/pdf";
import { getQuotation } from "@/lib/quotations";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await params;

    // getQuotation scopes by organizationId, so one tenant cannot read another's.
    const quotation = await getQuotation(session.organizationId, id);
    const profile = await prisma.businessProfile.findUnique({
      where: { organizationId: session.organizationId },
    });

    const pdf = await renderQuotationPdf(quotation, {
      legalName: profile?.legalName ?? session.organization.name,
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
    });

    return new NextResponse(pdf as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${quotation.number}.pdf"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
