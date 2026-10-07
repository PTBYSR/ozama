import { NextRequest, NextResponse } from "next/server";
import { getOrder } from "@/lib/orders";
import { advanceOrderStep } from "@/lib/bot-dispatcher";

export const maxDuration = 60;

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json({ error: "Missing order ID" }, { status: 400 });
  }

  let order = await getOrder(id);

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
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
