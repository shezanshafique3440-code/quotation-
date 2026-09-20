import type { Metadata } from "next";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { bpToInput } from "@/lib/format";
import { requireTenant } from "@/lib/tenant";
import { BusinessProfileForm } from "./form";

export const metadata: Metadata = { title: "Business profile" };

export default async function BusinessProfilePage() {
  const { profile } = await requireTenant();

  return (
    <>
      <PageHeader
        title="Business profile"
        description="Used on every quotation PDF, WhatsApp message and AI draft."
      />

      <Card>
        <CardHeader title="Details" />
        <BusinessProfileForm
          values={{
            legalName: profile.legalName,
            currency: profile.currency,
            locale: profile.locale,
            email: profile.email ?? "",
            phone: profile.phone ?? "",
            whatsappNumber: profile.whatsappNumber ?? "",
            website: profile.website ?? "",
            addressLine1: profile.addressLine1 ?? "",
            addressLine2: profile.addressLine2 ?? "",
            city: profile.city ?? "",
            postalCode: profile.postalCode ?? "",
            country: profile.country ?? "",
            taxId: profile.taxId ?? "",
            taxRate: bpToInput(profile.taxRateBp),
            logoUrl: profile.logoUrl ?? "",
            quoteNumberPrefix: profile.quoteNumberPrefix,
            defaultValidityDays: String(profile.defaultValidityDays),
            defaultTerms: profile.defaultTerms ?? "",
            defaultNotes: profile.defaultNotes ?? "",
          }}
        />
      </Card>
    </>
  );
}
