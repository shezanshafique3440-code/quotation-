import { PrismaClient } from "@prisma/client";
import nextEnv from "@next/env";
import { fileURLToPath } from "node:url";
import { hashPassword } from "@/lib/password";

const root = fileURLToPath(new URL("../", import.meta.url));
nextEnv.loadEnvConfig(root, true, { info() {}, error() {} });

const email = "pro-owner@quoteflow.test";
const slug = "quoteflow-local-pro-demo";
const prisma = new PrismaClient();

async function main() {
  const origin = new URL(process.env.APP_URL || "http://localhost:3000");
  if (process.env.NODE_ENV === "production" ||
      origin.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
      origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash ||
      !process.env.DATABASE_URL?.startsWith("file:")) {
    throw new Error("Local demo fixtures require a development SQLite database and HTTP loopback APP_URL.");
  }

  const existing = await prisma.user.findUnique({
    where: { email }, include: { memberships: { include: { organization: true } } },
  });
  if (existing) {
    if (!existing.memberships.some(({ organization }) => organization.slug === slug)) {
      throw new Error("The local demo email already belongs to another workspace. Existing data was preserved.");
    }
    console.log("Local Pro demo already exists; retained its data and password.");
    return;
  }
  if (await prisma.organization.findUnique({ where: { slug } })) {
    throw new Error("The local demo workspace name is already in use. Existing data was preserved.");
  }
  const passwordHash = await hashPassword("quoteflow-local-pro-2026");
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, name: "Local Pro Owner", passwordHash } });
    const organization = await tx.organization.create({ data: {
      name: "QuoteFlow Local Pro Demo", slug, plan: "pro",
      memberships: { create: { userId: user.id, role: "owner" } },
      profile: { create: {
        legalName: "QuoteFlow Local Pro Demo", currency: "PKR", locale: "en-PK", timezone: "Asia/Karachi",
        taxRateBp: 1000, quoteNumberPrefix: "DEMO", brandColor: "#1f7a5a",
      } },
    } });
    const customer = await tx.customer.create({ data: {
      organizationId: organization.id, name: "Local test customer", email: "customer@example.test",
    } });
    await tx.product.create({ data: {
      organizationId: organization.id, name: "Local test service", sku: "LOCAL-SERVICE",
      unitPriceCents: 100000, taxRateBp: 1000, unit: "service",
    } });
    await tx.inquiry.create({ data: {
      organizationId: organization.id, customerId: customer.id, channel: "web",
      subject: "Local quotation test", message: "Please quote for one local test service.",
    } });
  });
  console.log("Local Pro demo prepared. Test-account details are in docs/LOCAL_WINDOWS.md.");
  console.log("This is a local fixture; no Stripe payment or subscription was created.");
}

main().catch((error) => {
  console.error(error instanceof Error && !error.message.includes("Invalid `")
    ? error.message : "Local demo could not be prepared. Existing user data was not reset.");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
