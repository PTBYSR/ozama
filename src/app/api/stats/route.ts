import { NextResponse } from "next/server";
import { getGlobalStats } from "@/lib/mongodb";

export async function GET() {
  try {
    const stats = await getGlobalStats();
    return NextResponse.json({
      success: true,
      totalAmount: stats.totalAmount,
      totalPlayers: stats.totalPlayers,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to load stats" },
      { status: 500 }
    );
  }
}
