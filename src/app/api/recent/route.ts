import { NextResponse } from "next/server";
import { getRecentOrders } from "@/lib/orders";

export async function GET() {
  const recent = await getRecentOrders(8);
  return NextResponse.json({
    orders: recent,
    poolStatus: "online",
    activeBots: 2699,
  });
}
