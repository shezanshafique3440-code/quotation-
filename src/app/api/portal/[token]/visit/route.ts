import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { loadPortal, recordPortalVisit } from "@/lib/portal";
import { consumeRateLimit } from "@/lib/rate-limit";
import { clientIp, clientIpHash, looksAutomated, userAgent } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const limit = await consumeRateLimit("portalAccess", clientIp(request.headers));
    if (!limit.allowed) return NextResponse.json({ recorded: false });

    const session = await loadPortal(token);
    if (!session) return NextResponse.json({ recorded: false });

    const agent = userAgent(request.headers);
    await recordPortalVisit(token, session, {
      ipHash: clientIpHash(request.headers),
      userAgent: agent,
      automated: looksAutomated(agent),
    });

    return NextResponse.json({ recorded: true });
  } catch (error) {
    return jsonError(error);
  }
}
