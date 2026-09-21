import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { describeEnvironment } from "@/lib/env";

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

  const environment = describeEnvironment();

  return NextResponse.json(
    {
      status: database === "up" ? "ok" : "degraded",
      database,
      nodeEnv: environment.nodeEnv,
      integrations: {
        ai: environment.ai,
        billing: environment.billing,
        cron: environment.cron,
        publicPages: environment.publicPages,
      },
      warnings: environment.warnings,
    },
    {
      status: database === "up" ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
