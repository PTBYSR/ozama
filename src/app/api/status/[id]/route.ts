import { NextRequest, NextResponse } from "next/server";
import { getOrder } from "@/lib/orders";
import { processOrderBackground } from "@/lib/bot-dispatcher";

export const maxDuration = 60;

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json({ error: "Missing order ID" }, { status: 400 });
  }

  const order = await getOrder(id);

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Self-healing: if order is still active, ensure dispatcher continues running
  if (order.status !== "completed" && order.status !== "failed") {
    processOrderBackground(id).catch(console.error);
  }

  return NextResponse.json({ order });
}
