/**
 * Workspace roles.
 *
 * The matrix is deliberately small. Day-to-day work — inquiries, quotations,
 * customers, the catalog, templates, follow-ups — is open to every member,
 * because a teammate who cannot quote is not a teammate. What is restricted is
 * the set of actions that change the *workspace* rather than the work in it:
 * who belongs to it, how it bills, and how it presents itself to customers.
 */
export const ROLES = ["owner", "admin", "member"] as const;
export type Role = (typeof ROLES)[number];

/** Roles an invitation may grant. Ownership is never handed out by email. */
export const INVITABLE_ROLES = ["admin", "member"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Full access, including billing and removing the workspace.",
  admin: "Everything except billing — including the business profile and teammates.",
  member: "Quotes, customers, catalog and follow-ups. Cannot change workspace settings.",
};

export type Permission =
  /** Invite, remove and re-role teammates. */
  | "members:manage"
  /** Change the business profile, branding and notification preferences. */
  | "settings:manage"
  /** Start checkout and open the billing portal. */
  | "billing:manage";

const MATRIX: Record<Role, readonly Permission[]> = {
  owner: ["members:manage", "settings:manage", "billing:manage"],
  admin: ["members:manage", "settings:manage"],
  member: [],
};

export function can(role: string, permission: Permission): boolean {
  if (!isRole(role)) return false;
  return MATRIX[role].includes(permission);
}

/**
 * Whether `actor` may act on `target`'s membership.
 *
 * An admin may manage members but not other admins or the owner, so one admin
 * cannot quietly remove the people who could undo it.
 */
export function canActOn(actorRole: string, targetRole: string): boolean {
  if (!isRole(actorRole) || !isRole(targetRole)) return false;
  if (!can(actorRole, "members:manage")) return false;
  if (actorRole === "owner") return true;
  return targetRole === "member";
}
