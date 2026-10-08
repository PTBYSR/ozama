import { NextRequest, NextResponse } from "next/server";
import { getOrder } from "@/lib/orders";
import { advanceOrderStep, resumeOrder, cancelOrder } from "@/lib/bot-dispatcher";

export const maxDuration = 60;

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json({ error: "Missing order ID" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const isResume = searchParams.get("action") === "resume";
  const isCancel = searchParams.get("action") === "cancel";

  let order = await getOrder(id);

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (isCancel) {
    const cancelled = await cancelOrder(id);
    return NextResponse.json({ order: cancelled, cancelled: true });
  }

  if (isResume && order.status === "failed") {
    const resumed = await resumeOrder(id);
    if (resumed) order = resumed;
  }

  // Active orders advance step-by-step on every client poll (100% resilient on serverless & Vercel)
  if (order.status !== "completed" && order.status !== "failed") {
    const updated = await advanceOrderStep(id);
    if (updated) {
      order = updated;
    }
  }

  return NextResponse.json({ order });
}
