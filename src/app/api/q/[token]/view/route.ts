import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { consumeRateLimit } from "@/lib/rate-limit";
import { clientIp, clientIpHash, looksAutomated, userAgent } from "@/lib/request";
import { notifyView } from "@/lib/notifications";
import { loadPublicQuotation, recordPublicView } from "@/lib/sharing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Called by the share page once it has actually rendered in a browser.
 *
 * Tracking the view here rather than during server rendering means a link
 * unfurler or a crawler fetching the HTML does not get reported to the owner
 * as "your customer opened the quote".
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const agent = userAgent(request.headers);

    const limit = await consumeRateLimit("publicView", clientIp(request.headers));
    if (!limit.allowed) {
      // Silently skip rather than error: a missed view counter must never
      // break the page the customer is reading.
      return NextResponse.json({ recorded: false }, { status: 200 });
    }

    const record = await loadPublicQuotation(token);
    if (!record) return NextResponse.json({ recorded: false }, { status: 200 });

    const outcome = await recordPublicView(record, {
      ipHash: clientIpHash(request.headers),
      userAgent: agent,
      automated: looksAutomated(agent),
    });

    if (outcome.counted) {
      await notifyView({
        organizationId: record.organizationId,
        organizationName: record.organization.name,
        quotationId: record.id,
        customerName: record.customer.name,
        firstView: outcome.firstView,
      });
    }

    return NextResponse.json({ recorded: outcome.counted });
  } catch (error) {
    return jsonError(error);
  }
}
