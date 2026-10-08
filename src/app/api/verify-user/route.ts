import { NextRequest, NextResponse } from "next/server";
import { resolvePlayer } from "@/lib/lagos-api";
import { antiBot } from "@/lib/anti-bot";
import { checkRateLimit } from "@/lib/rate-limiter";

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
      // Also check player cooldown status in real-time
      const limitStatus = await checkRateLimit(username, 0);

      return NextResponse.json({
        exists: true,
        player: {
          id: player.id,
          username: player.username,
        },
        canFund: limitStatus.canFund,
        cooldownSeconds: limitStatus.cooldownSeconds,
        cooldownFormatted: limitStatus.cooldownFormatted,
        dailyTriesRemaining: limitStatus.dailyTriesRemaining,
        dailyLimitReached: limitStatus.dailyLimitReached,
        limitReason: limitStatus.reason,
      });
    }
    return NextResponse.json({
      exists: false,
      error: "This account does not exist on Lagos Life. Please check the spelling.",
    });
  } catch (err: any) {
    return NextResponse.json({
      exists: false,
      error: "Could not connect to Lagos Life right now. Please try again in a moment.",
    });
  }
}
