import { NextRequest, NextResponse } from "next/server";
import { checkAdminRequest } from "@/lib/admin-auth";
import { dbAdapter } from "@/lib/mongodb";

export async function POST(req: NextRequest) {
  if (!checkAdminRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const username = (body.username || "").trim().replace(/^@+/, "");

    if (!username) {
      return NextResponse.json({ error: "Username is required" }, { status: 400 });
    }

    await dbAdapter.resetUserCooldown(username);

    return NextResponse.json({
      success: true,
      message: `Cooldown and limits reset successfully for @${username}`,
    });
  } catch (error: any) {
    console.error("Reset user error:", error);
    return NextResponse.json({ error: "Failed to reset user" }, { status: 500 });
  }
}
