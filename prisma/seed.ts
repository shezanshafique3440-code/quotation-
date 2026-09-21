/**
 * Development seed. Creates one workspace with a catalog, a customer, an
 * inquiry and a sent quotation so the UI has something real to render.
 *
 * Run with: npm run db:seed
 */
import { randomBytes } from "node:crypto";
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
          timezone: "Europe/London",
          brandColor: "#1f7a5a",
          portalHeadline: "Your quotations from Northline",
          portalMessage:
            "Everything we have quoted you. Open one to accept or decline it — or reply on WhatsApp if something needs changing.",
          autoFollowUpEnabled: true,
          autoFollowUpDays: 3,
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

  const template = await prisma.quotationTemplate.create({
    data: {
      organizationId: organization.id,
      name: "Alcove shelving — standard",
      description: "The job we quote most weeks.",
      titlePattern: "{subject}",
      isDefault: true,
      validityDays: 21,
      requireSignature: true,
      notes: "Lead time is currently 3-4 weeks from deposit.",
      terms: "50% deposit to book the slot, balance due on completion.",
      items: {
        create: [
          {
            productId: products[2]!.id,
            position: 0,
            description: "Site survey and setting out",
            quantity: 1,
            unit: "visit",
            unitPriceCents: products[2]!.unitPriceCents,
            taxRateBp: 2000,
          },
          {
            productId: products[0]!.id,
            position: 1,
            description: "Bespoke oak shelving",
            quantity: 3.6,
            unit: "linear metre",
            unitPriceCents: products[0]!.unitPriceCents,
            taxRateBp: 2000,
          },
          {
            productId: products[3]!.id,
            position: 2,
            description: "Fitting labour, two fitters",
            quantity: 6,
            unit: "hour",
            unitPriceCents: products[3]!.unitPriceCents,
            taxRateBp: 2000,
          },
        ],
      },
    },
  });

  const quotation = await prisma.quotation.create({
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
      templateId: template.id,
      baseCurrency: "GBP",
      exchangeRateToBase: 1,
      requireSignature: true,
      // A live share link, so the demo workspace shows the customer-facing page.
      publicToken: randomBytes(24).toString("base64url"),
      publicEnabled: true,
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

  // A short timeline so the activity views are not empty on a fresh install.
  await prisma.activityEvent.createMany({
    data: [
      {
        organizationId: organization.id,
        category: "quotation",
        kind: "quotation.created",
        summary: `Sam Rivera created ${quotation.number}`,
        actorType: "user",
        actorId: user.id,
        actorLabel: "Sam Rivera",
        quotationId: quotation.id,
        customerId: customer.id,
        createdAt: new Date(Date.now() - 2 * 86_400_000),
      },
      {
        organizationId: organization.id,
        category: "quotation",
        kind: "quotation.sent",
        summary: `Sam Rivera marked ${quotation.number} as sent`,
        actorType: "user",
        actorId: user.id,
        actorLabel: "Sam Rivera",
        quotationId: quotation.id,
        customerId: customer.id,
        createdAt: new Date(Date.now() - 2 * 86_400_000 + 3_600_000),
      },
    ],
  });

  // A little history, so the analytics page and the funnel are not empty on a
  // fresh install. Each one carries the timestamps the funnel actually reads.
  const history: {
    status: string;
    daysAgo: number;
    totalCents: number;
    title: string;
  }[] = [
    { status: "accepted", daysAgo: 100, totalCents: 410_000, title: "Boot room joinery — Roundhay" },
    { status: "accepted", daysAgo: 70, totalCents: 320_000, title: "Under-stairs storage — Horsforth" },
    { status: "expired", daysAgo: 68, totalCents: 140_000, title: "Garage shelving — Meanwood" },
    { status: "accepted", daysAgo: 40, totalCents: 250_000, title: "Media wall — Headingley" },
    { status: "rejected", daysAgo: 38, totalCents: 180_000, title: "Wardrobe doors — Kirkstall" },
    { status: "rejected", daysAgo: 14, totalCents: 96_000, title: "Window seat — Armley" },
    { status: "accepted", daysAgo: 12, totalCents: 175_000, title: "Home office desk — Bramley" },
    { status: "sent", daysAgo: 9, totalCents: 220_000, title: "Pantry fit-out — Adel" },
  ];

  const day = 86_400_000;
  for (const [index, entry] of history.entries()) {
    const sentAt = new Date(Date.now() - entry.daysAgo * day);
    const decided = entry.status === "accepted" || entry.status === "rejected";

    await prisma.quotation.create({
      data: {
        organizationId: organization.id,
        number: `NJ-2025-${String(index + 1).padStart(4, "0")}`,
        customerId: customer.id,
        createdById: user.id,
        status: entry.status,
        title: entry.title,
        currency: "GBP",
        baseCurrency: "GBP",
        exchangeRateToBase: 1,
        subtotalCents: entry.totalCents,
        taxCents: 0,
        totalCents: entry.totalCents,
        createdAt: sentAt,
        sentAt,
        // Only quotations that were actually opened carry a view timestamp.
        firstViewedAt: entry.status === "sent" ? null : new Date(sentAt.getTime() + 2 * 3_600_000),
        lastViewedAt: entry.status === "sent" ? null : new Date(sentAt.getTime() + 2 * 3_600_000),
        viewCount: entry.status === "sent" ? 0 : 2,
        respondedAt: decided ? new Date(sentAt.getTime() + 2 * day) : null,
        decidedAt: decided ? new Date(sentAt.getTime() + 2 * day) : null,
        decisionSource: decided ? "public_page" : null,
        respondedByName: decided ? "Dana Whitfield" : null,
        items: {
          create: {
            position: 0,
            description: entry.title,
            quantity: 1,
            unit: "job",
            unitPriceCents: entry.totalCents,
            taxRateBp: 0,
            lineTotalCents: entry.totalCents,
          },
        },
      },
    });
  }

  console.log("Seed complete.");
  console.log(`  Sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Public quotation page: /q/${quotation.publicToken}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
