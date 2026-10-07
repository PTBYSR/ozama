import { NextRequest, NextResponse } from "next/server";
import { getRecentOrders } from "@/lib/orders";

export async function GET(req: NextRequest) {
  const recent = await getRecentOrders(8);
  return NextResponse.json(
    {
      orders: recent,
      poolStatus: "online",
      activeBots: 2699,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
