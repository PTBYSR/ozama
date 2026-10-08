import { NextRequest, NextResponse } from "next/server";
import { checkAdminRequest } from "@/lib/admin-auth";
import { dbAdapter } from "@/lib/mongodb";

export async function GET(req: NextRequest) {
  if (!checkAdminRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const blockedIps = await dbAdapter.getBlockedIps();
    return NextResponse.json({ blockedIps });
  } catch (error: any) {
    return NextResponse.json({ error: "Failed to fetch blocked IPs" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!checkAdminRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const ip = (body.ip || "").trim();
    const reason = (body.reason || "Restricted by administrator").trim();

    if (!ip || ip.length < 3) {
      return NextResponse.json({ error: "Valid IP address is required" }, { status: 400 });
    }

    const doc = await dbAdapter.blockIp(ip, reason);
    return NextResponse.json({ success: true, blocked: doc });
  } catch (error: any) {
    return NextResponse.json({ error: "Failed to block IP" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!checkAdminRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    let ip = searchParams.get("ip") || "";
    if (!ip) {
      try {
        const body = await req.json();
        ip = body.ip || "";
      } catch {}
    }

    if (!ip) {
      return NextResponse.json({ error: "IP is required to unblock" }, { status: 400 });
    }

    await dbAdapter.unblockIp(ip);
    return NextResponse.json({ success: true, unblocked: ip });
  } catch (error: any) {
    return NextResponse.json({ error: "Failed to unblock IP" }, { status: 500 });
  }
}
