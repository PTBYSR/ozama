import { NextRequest, NextResponse } from "next/server";
import { capacityTracker } from "@/lib/capacity-tracker";
import { dbAdapter } from "@/lib/mongodb";

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

    // Sync configured max capacity from database settings (cached)
    const settings = await dbAdapter.getSystemSettings();
    const configuredCapacity = settings?.maxCapacity ?? capacityTracker.getMaxCapacity();

    const result = capacityTracker.heartbeat(sessionId, ip, configuredCapacity);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to process capacity" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const settings = await dbAdapter.getSystemSettings();
  const configuredCapacity = settings?.maxCapacity ?? capacityTracker.getMaxCapacity();
  capacityTracker.setMaxCapacity(configuredCapacity);
  const activeCount = capacityTracker.getActiveCount();

  return NextResponse.json(
    {
      activeCount,
      maxCapacity: configuredCapacity,
      availableSlots: Math.max(0, configuredCapacity - activeCount),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
