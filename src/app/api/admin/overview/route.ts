import { NextRequest, NextResponse } from "next/server";
import { checkAdminRequest } from "@/lib/admin-auth";
import { dbAdapter, getDbDiagnostics } from "@/lib/mongodb";
import { TOTAL_BOT_POOL } from "@/lib/bot-dispatcher";

export async function GET(req: NextRequest) {
  if (!checkAdminRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [settings, globalStats, users, orders] = await Promise.all([
      dbAdapter.getSystemSettings(),
      dbAdapter.getStats(),
      dbAdapter.getUserSummaries(),
      dbAdapter.getAllOrders(100),
    ]);

    const completedCount = orders.filter((o) => o.status === "completed").length;
    const failedCount = orders.filter((o) => o.status === "failed").length;
    const activeCount = orders.filter((o) => o.status === "streaming" || o.status === "allocating" || o.status === "queued").length;

    return NextResponse.json(
      {
        systemStatus: settings,
        dbDiagnostics: getDbDiagnostics(),
        stats: {
          totalAmount: globalStats.totalAmount,
          totalPlayers: Math.max(globalStats.totalPlayers, users.length),
          totalOrders: orders.length,
          completedOrders: completedCount,
          failedOrders: failedCount,
          activeOrders: activeCount,
          botPoolSize: TOTAL_BOT_POOL,
        },
        users,
        orders,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error: any) {
    console.error("Admin overview error:", error);
    return NextResponse.json({ error: "Failed to load admin overview" }, { status: 500 });
  }
}
