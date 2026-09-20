"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Field } from "@/components/ui";
import { idleState } from "@/lib/action-state";
import { updateBusinessProfileAction } from "@/server/profile-actions";

export interface ProfileValues {
  legalName: string;
  currency: string;
  locale: string;
  email: string;
  phone: string;
  whatsappNumber: string;
  website: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postalCode: string;
  country: string;
  taxId: string;
  taxRate: string;
  logoUrl: string;
  quoteNumberPrefix: string;
  defaultValidityDays: string;
  defaultTerms: string;
  defaultNotes: string;
}

export function BusinessProfileForm({ values }: { values: ProfileValues }) {
  const [state, action] = useActionState(updateBusinessProfileAction, idleState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-6 px-5 py-5" noValidate>
      {state.status === "error" && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? (
        <Alert tone="positive">{state.message}</Alert>
      ) : null}

      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Identity</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name" htmlFor="legalName" error={errors.legalName}>
            <input
              id="legalName"
              name="legalName"
              className="input"
              required
              maxLength={160}
              defaultValue={values.legalName}
            />
          </Field>
          <Field label="Tax ID / VAT number" htmlFor="taxId" error={errors.taxId}>
            <input id="taxId" name="taxId" className="input" defaultValue={values.taxId} />
          </Field>
          <Field label="Email" htmlFor="email" error={errors.email}>
            <input id="email" name="email" type="email" className="input" defaultValue={values.email} />
          </Field>
          <Field label="Phone" htmlFor="phone" error={errors.phone}>
            <input id="phone" name="phone" className="input" defaultValue={values.phone} />
          </Field>
          <Field
            label="Your WhatsApp number"
            htmlFor="whatsappNumber"
            error={errors.whatsappNumber}
            hint="Shown to your team; customer numbers live on each customer record."
          >
            <input
              id="whatsappNumber"
              name="whatsappNumber"
              className="input"
              defaultValue={values.whatsappNumber}
              placeholder="+15551234567"
            />
          </Field>
          <Field label="Website" htmlFor="website" error={errors.website}>
            <input
              id="website"
              name="website"
              className="input"
              defaultValue={values.website}
              placeholder="https://example.com"
            />
          </Field>
          <Field
            label="Logo URL"
            htmlFor="logoUrl"
            error={errors.logoUrl}
            hint="Stored for future use; the PDF currently prints your business name as the letterhead."
          >
            <input id="logoUrl" name="logoUrl" className="input" defaultValue={values.logoUrl} />
          </Field>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Address</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Address line 1" htmlFor="addressLine1" error={errors.addressLine1}>
            <input
              id="addressLine1"
              name="addressLine1"
              className="input"
              defaultValue={values.addressLine1}
            />
          </Field>
          <Field label="Address line 2" htmlFor="addressLine2" error={errors.addressLine2}>
            <input
              id="addressLine2"
              name="addressLine2"
              className="input"
              defaultValue={values.addressLine2}
            />
          </Field>
          <Field label="City" htmlFor="city" error={errors.city}>
            <input id="city" name="city" className="input" defaultValue={values.city} />
          </Field>
          <Field label="Postal code" htmlFor="postalCode" error={errors.postalCode}>
            <input id="postalCode" name="postalCode" className="input" defaultValue={values.postalCode} />
          </Field>
          <Field label="Country" htmlFor="country" error={errors.country}>
            <input id="country" name="country" className="input" defaultValue={values.country} />
          </Field>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Quotation defaults</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Currency"
            htmlFor="currency"
            error={errors.currency}
            hint="ISO code, e.g. USD"
          >
            <input
              id="currency"
              name="currency"
              className="input uppercase"
              maxLength={3}
              required
              defaultValue={values.currency}
            />
          </Field>
          <Field label="Locale" htmlFor="locale" error={errors.locale} hint="e.g. en-GB, es-MX">
            <input id="locale" name="locale" className="input" defaultValue={values.locale} />
          </Field>
          <Field label="Default tax rate (%)" htmlFor="taxRate" error={errors.taxRateBp}>
            <input
              id="taxRate"
              name="taxRate"
              className="input tabular-nums"
              inputMode="decimal"
              defaultValue={values.taxRate}
            />
          </Field>
          <Field
            label="Quote number prefix"
            htmlFor="quoteNumberPrefix"
            error={errors.quoteNumberPrefix}
            hint="Numbers look like QT-2026-0001"
          >
            <input
              id="quoteNumberPrefix"
              name="quoteNumberPrefix"
              className="input uppercase"
              maxLength={8}
              defaultValue={values.quoteNumberPrefix}
            />
          </Field>
        </div>

        <Field
          label="Default validity (days)"
          htmlFor="defaultValidityDays"
          error={errors.defaultValidityDays}
        >
          <input
            id="defaultValidityDays"
            name="defaultValidityDays"
            className="input tabular-nums sm:max-w-40"
            inputMode="numeric"
            required
            defaultValue={values.defaultValidityDays}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Default notes" htmlFor="defaultNotes" error={errors.defaultNotes}>
            <textarea
              id="defaultNotes"
              name="defaultNotes"
              className="input min-h-28"
              maxLength={4000}
              defaultValue={values.defaultNotes}
            />
          </Field>
          <Field label="Default terms" htmlFor="defaultTerms" error={errors.defaultTerms}>
            <textarea
              id="defaultTerms"
              name="defaultTerms"
              className="input min-h-28"
              maxLength={4000}
              defaultValue={values.defaultTerms}
              placeholder="50% deposit to book, balance on completion. Prices exclude delivery."
            />
          </Field>
        </div>
      </div>

      <SubmitButton pendingLabel="Saving…">Save business profile</SubmitButton>
    </form>
  );
}
