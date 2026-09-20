import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAiConfigured, isBillingConfigured } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness plus a truthful report of which optional integrations are on. */
export async function GET() {
  let database: "up" | "down" = "up";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = "down";
  }

  return NextResponse.json(
    {
      status: database === "up" ? "ok" : "degraded",
      database,
      integrations: { ai: isAiConfigured(), billing: isBillingConfigured() },
    },
    { status: database === "up" ? 200 : 503 },
  );
}
