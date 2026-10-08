import { NextRequest, NextResponse } from "next/server";
import { checkAdminRequest } from "@/lib/admin-auth";
import { dbAdapter } from "@/lib/mongodb";

export async function POST(req: NextRequest) {
  if (!checkAdminRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const isLive = typeof body.isLive === "boolean" ? body.isLive : true;
    const maintenanceMessage = typeof body.maintenanceMessage === "string" ? body.maintenanceMessage : "";
    const killSwitch = typeof body.killSwitch === "boolean" ? body.killSwitch : false;
    const killSwitchMessage = typeof body.killSwitchMessage === "string" ? body.killSwitchMessage : "";

    const updated = await dbAdapter.updateSystemSettings({
      isLive,
      maintenanceMessage,
      killSwitch,
      killSwitchMessage,
    });

    return NextResponse.json({
      success: true,
      settings: updated,
    });
  } catch (error: any) {
    console.error("Failed to update system settings:", error);
    return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
  }
}
