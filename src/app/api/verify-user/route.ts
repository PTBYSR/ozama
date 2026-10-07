import { NextRequest, NextResponse } from "next/server";
import { resolvePlayer } from "@/lib/lagos-api";
import { antiBot } from "@/lib/anti-bot";

export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
  const ipCheck = antiBot.checkIpRate(ip, 30);
  if (!ipCheck.allowed) {
    return NextResponse.json(
      { exists: false, error: "Too many player verification requests. Please slow down." },
      { status: 429 }
    );
  }

  const { searchParams } = new URL(req.url);
  const rawUsername = searchParams.get("username") || "";
  const username = rawUsername.trim().replace(/^@+/, "");

  if (!username || username.length < 3) {
    return NextResponse.json({ exists: false, error: "Username must be at least 3 characters" });
  }

  try {
    const player = await resolvePlayer(username);
    if (player && player.username.toLowerCase() === username.toLowerCase()) {
      return NextResponse.json({
        exists: true,
        player: {
          id: player.id,
          username: player.username,
        },
      });
    }
    return NextResponse.json({ exists: false, error: "Player not found on Lagos Life" });
  } catch (err: any) {
    return NextResponse.json({ exists: false, error: err.message });
  }
}
