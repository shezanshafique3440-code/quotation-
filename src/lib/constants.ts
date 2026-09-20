/** Shared with client components, so this file must stay free of Node built-ins. */
export const MIN_PASSWORD_LENGTH = 10;

export const INQUIRY_CHANNELS = ["whatsapp", "email", "phone", "web", "walk_in", "other"] as const;
export type InquiryChannel = (typeof INQUIRY_CHANNELS)[number];

export const INQUIRY_STATUSES = ["new", "quoted", "won", "archived"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const QUOTATION_STATUSES = ["draft", "sent", "accepted", "rejected", "expired"] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export const REMINDER_CHANNELS = ["whatsapp", "email", "call"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export const REMINDER_CHANNEL_LABELS: Record<ReminderChannel, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  call: "Phone call",
};

export const REMINDER_STATUSES = ["pending", "done", "cancelled"] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const ROLES = ["owner", "admin", "member"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Allowed quotation status transitions. `draft` may go out or be abandoned;
 * a decided quotation is terminal so that reporting stays trustworthy.
 */
export const QUOTATION_TRANSITIONS: Record<QuotationStatus, readonly QuotationStatus[]> = {
  draft: ["sent"],
  sent: ["accepted", "rejected", "expired", "draft"],
  accepted: [],
  rejected: ["draft"],
  expired: ["draft", "sent"],
};

export function canTransition(from: string, to: string): boolean {
  const allowed = QUOTATION_TRANSITIONS[from as QuotationStatus];
  return Boolean(allowed?.includes(to as QuotationStatus));
}

export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
};

export const INQUIRY_CHANNEL_LABELS: Record<InquiryChannel, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  phone: "Phone",
  web: "Website",
  walk_in: "Walk-in",
  other: "Other",
};

export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  new: "New",
  quoted: "Quoted",
  won: "Won",
  archived: "Archived",
};
