import { NextRequest, NextResponse } from "next/server";
import { capacityTracker } from "@/lib/capacity-tracker";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const sessionId = (body.sessionId || "").trim();
    const action = body.action || "heartbeat";

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";

    if (action === "release") {
      capacityTracker.release(sessionId);
      return NextResponse.json({ released: true });
    }

    const result = capacityTracker.heartbeat(sessionId, ip);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to process capacity" },
      { status: 500 }
    );
  }
}

export async function GET() {
  const activeCount = capacityTracker.getActiveCount();
  return NextResponse.json({
    activeCount,
    maxCapacity: capacityTracker.MAX_CAPACITY,
    availableSlots: Math.max(0, capacityTracker.MAX_CAPACITY - activeCount),
  });
}
