import { NextRequest, NextResponse } from "next/server";
import { dbAdapter } from "@/lib/mongodb";

export async function GET(req: NextRequest) {
  try {
    const settings = await dbAdapter.getSystemSettings();
    return NextResponse.json(
      {
        isLive: settings.isLive,
        maintenanceMessage: settings.maintenanceMessage || "",
        updatedAt: settings.updatedAt,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (error: any) {
    console.error("System status API error:", error);
    return NextResponse.json(
      { isLive: true, maintenanceMessage: "", updatedAt: new Date().toISOString() },
      { status: 200 }
    );
  }
}
