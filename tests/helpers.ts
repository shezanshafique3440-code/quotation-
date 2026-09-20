import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";

/** Truncate every table. Order matters: children before parents. */
export async function resetDatabase(): Promise<void> {
  await prisma.usageEvent.deleteMany();
  await prisma.reminder.deleteMany();
  await prisma.quotationItem.deleteMany();
  await prisma.quotation.deleteMany();
  await prisma.inquiry.deleteMany();
  await prisma.product.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.session.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.businessProfile.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.user.deleteMany();
}

export interface Workspace {
  userId: string;
  organizationId: string;
  customerId: string;
  productId: string;
  inquiryId: string;
}

let counter = 0;

/** A complete, realistic tenant: user, org, profile, catalog, customer, inquiry. */
export async function createWorkspace(
  overrides: { plan?: string; name?: string } = {},
): Promise<Workspace> {
  counter += 1;
  const name = overrides.name ?? `Workspace ${counter}`;

  const user = await prisma.user.create({
    data: {
      email: `owner${counter}@example.test`,
      name: `Owner ${counter}`,
      passwordHash: await hashPassword("correct-horse-battery"),
    },
  });

  const organization = await prisma.organization.create({
    data: {
      name,
      slug: `workspace-${counter}`,
      plan: overrides.plan ?? "free",
      memberships: { create: { userId: user.id, role: "owner" } },
      profile: { create: { legalName: name, currency: "USD", taxRateBp: 1000 } },
    },
  });

  const customer = await prisma.customer.create({
    data: {
      organizationId: organization.id,
      name: `Customer ${counter}`,
      whatsapp: "+15551234567",
    },
  });

  const product = await prisma.product.create({
    data: {
      organizationId: organization.id,
      name: `Product ${counter}`,
      unitPriceCents: 10_000,
      unit: "unit",
      taxRateBp: 1000,
    },
  });

  const inquiry = await prisma.inquiry.create({
    data: {
      organizationId: organization.id,
      customerId: customer.id,
      channel: "whatsapp",
      subject: "Need a price",
      message: "Can you quote for two of these?",
    },
  });

  return {
    userId: user.id,
    organizationId: organization.id,
    customerId: customer.id,
    productId: product.id,
    inquiryId: inquiry.id,
  };
}

export function quotationInput(workspace: Workspace, overrides: Record<string, unknown> = {}) {
  return {
    customerId: workspace.customerId,
    title: "Test quotation",
    currency: "USD",
    discountCents: 0,
    items: [
      {
        productId: workspace.productId,
        description: "Two units",
        quantity: 2,
        unit: "unit",
        unitPriceCents: 10_000,
        taxRateBp: 1000,
      },
    ],
    ...overrides,
  } as Parameters<typeof import("@/lib/quotations").createQuotation>[0]["input"];
}
