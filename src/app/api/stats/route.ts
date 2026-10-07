import { NextRequest, NextResponse } from "next/server";
import { getGlobalStats } from "@/lib/mongodb";

export async function GET(req: NextRequest) {
  try {
    const stats = await getGlobalStats();
    return NextResponse.json(
      {
        success: true,
        totalAmount: stats.totalAmount,
        totalPlayers: stats.totalPlayers,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to load stats" },
      { status: 500 }
    );
  }
}
