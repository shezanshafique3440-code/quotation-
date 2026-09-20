/**
 * Development seed. Creates one workspace with a catalog, a customer, an
 * inquiry and a sent quotation so the UI has something real to render.
 *
 * Run with: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";
import { computeTotals } from "../src/lib/money";

const prisma = new PrismaClient();

const DEMO_EMAIL = "owner@northline.test";
const DEMO_PASSWORD = "northline-demo-2026";

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    console.log(`Seed skipped — ${DEMO_EMAIL} already exists.`);
    return;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const user = await prisma.user.create({
    data: { email: DEMO_EMAIL, name: "Sam Rivera", passwordHash },
  });

  const organization = await prisma.organization.create({
    data: {
      name: "Northline Joinery",
      slug: "northline-joinery",
      memberships: { create: { userId: user.id, role: "owner" } },
      profile: {
        create: {
          legalName: "Northline Joinery Ltd",
          currency: "GBP",
          locale: "en-GB",
          email: "hello@northline.test",
          phone: "+441132960000",
          whatsappNumber: "+441132960000",
          city: "Leeds",
          country: "United Kingdom",
          taxId: "GB123456789",
          taxRateBp: 2000,
          quoteNumberPrefix: "NJ",
          defaultValidityDays: 21,
          defaultTerms:
            "50% deposit to book the slot, balance due on completion. Prices exclude delivery outside West Yorkshire.",
          defaultNotes: "Lead time is currently 3-4 weeks from deposit.",
        },
      },
    },
  });

  const products = await Promise.all(
    [
      {
        name: "Bespoke oak shelving",
        sku: "OAK-SHELF",
        description: "Solid oak, hand-finished, fitted to the alcove.",
        unitPriceCents: 18_500,
        unit: "linear metre",
        taxRateBp: 2000,
      },
      {
        name: "Birch ply carcass",
        sku: "BIRCH-CAR",
        description: "18mm birch ply carcass, sprayed in any RAL colour.",
        unitPriceCents: 12_000,
        unit: "linear metre",
        taxRateBp: 2000,
      },
      {
        name: "Site survey and setting out",
        sku: "SURVEY",
        description: "Measure, template and setting-out drawings.",
        unitPriceCents: 9_500,
        unit: "visit",
        taxRateBp: 2000,
      },
      {
        name: "Fitting labour",
        sku: "LABOUR",
        description: "Two fitters on site.",
        unitPriceCents: 4_800,
        unit: "hour",
        taxRateBp: 2000,
      },
    ].map((data) => prisma.product.create({ data: { organizationId: organization.id, ...data } })),
  );

  const customer = await prisma.customer.create({
    data: {
      organizationId: organization.id,
      name: "Dana Whitfield",
      company: "Whitfield Interiors",
      email: "dana@whitfield.test",
      phone: "+447700900123",
      whatsapp: "+447700900123",
      notes: "Prefers WhatsApp. Specifies for two developers in Chapel Allerton.",
    },
  });

  const inquiry = await prisma.inquiry.create({
    data: {
      organizationId: organization.id,
      customerId: customer.id,
      channel: "whatsapp",
      subject: "Alcove shelving for two flats",
      status: "quoted",
      message:
        "Hi — we need fitted alcove shelving for two flats in Chapel Allerton. Each flat has two alcoves, roughly 1.8m wide. Oak if it is not silly money, otherwise sprayed ply. We would need you to measure up first. Can you price it?",
    },
  });

  const items = [
    { product: products[2]!, description: "Site survey and setting out, both flats", quantity: 2 },
    { product: products[0]!, description: "Bespoke oak shelving, four alcoves at 1.8m", quantity: 7.2 },
    { product: products[3]!, description: "Fitting labour, two fitters", quantity: 12 },
  ];

  const totals = computeTotals(
    items.map((item) => ({
      quantity: item.quantity,
      unitPriceCents: item.product.unitPriceCents,
      taxRateBp: item.product.taxRateBp,
    })),
    5_000,
  );

  await prisma.quotation.create({
    data: {
      organizationId: organization.id,
      number: "NJ-2026-0001",
      customerId: customer.id,
      inquiryId: inquiry.id,
      createdById: user.id,
      status: "sent",
      sentAt: new Date(),
      title: "Alcove shelving — Chapel Allerton",
      currency: "GBP",
      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      notes: "Oak option quoted. Sprayed birch ply would come in around 30% lower — say the word.",
      terms: "50% deposit to book the slot, balance due on completion.",
      validUntil: new Date(Date.now() + 21 * 86_400_000),
      items: {
        create: items.map((item, index) => ({
          productId: item.product.id,
          position: index,
          description: item.description,
          quantity: item.quantity,
          unit: item.product.unit,
          unitPriceCents: item.product.unitPriceCents,
          taxRateBp: item.product.taxRateBp,
          lineTotalCents: totals.lines[index]!.lineTotalCents,
        })),
      },
      reminders: {
        create: {
          organizationId: organization.id,
          channel: "whatsapp",
          dueAt: new Date(Date.now() + 2 * 86_400_000),
          note: "Check whether Dana wants the oak or the sprayed ply option.",
        },
      },
    },
  });

  await prisma.usageEvent.create({
    data: { organizationId: organization.id, kind: "quotation_created" },
  });

  console.log("Seed complete.");
  console.log(`  Sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
