import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, normalizeUsername, isValidUsername } from "@/lib/rate-limiter";
import { createOrder } from "@/lib/orders";
import { antiBot } from "@/lib/anti-bot";

export const maxDuration = 60;

const ALLOWED_OPTIONS: Record<number, { windowSeconds: number; label: string }> = {
  500_000_000: { windowSeconds: 7200, label: "500M (2 Hours)" },
  25_000_000: { windowSeconds: 3600, label: "25M (1 Hour)" },
  10_000_000: { windowSeconds: 1800, label: "10M (30 Min)" },
};

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";

    // 1. Anti-Bot IP rate check (max 8 fundings attempted per min per IP)
    const ipCheck = antiBot.checkIpRate(ip, 8);
    if (!ipCheck.allowed) {
      return NextResponse.json(
        { error: `Too many requests from this network. Retry in ${ipCheck.retryAfterSeconds}s.` },
        { status: 429 }
      );
    }

    const body = await req.json();

    // 2. Anti-Bot Honeypot & Timing Token check
    const botCheck = antiBot.validateSubmission({
      honeypot: body.website,
      token: body.botToken,
      minElapsedMs: 1200,
    });
    if (!botCheck.passed) {
      return NextResponse.json(
        { error: botCheck.reason || "Anti-bot verification failed." },
        { status: 403 }
      );
    }

    const rawUsername = body.username || "";
    const amount = Number(body.amount);

    const username = normalizeUsername(rawUsername);

    if (!isValidUsername(username)) {
      return NextResponse.json(
        { error: "Invalid username. Must be 3–24 characters (letters, numbers, underscores)." },
        { status: 400 }
      );
    }

    const option = ALLOWED_OPTIONS[amount];
    if (!option) {
      return NextResponse.json(
        { error: "Invalid option selected. Choose 500M, 25M, or 10M." },
        { status: 400 }
      );
    }

    // 3. Check rate limits (Daily 5 tries limit & Tier cooldown window)
    const limitStatus = await checkRateLimit(username, amount, option.windowSeconds);

    if (!limitStatus.canFund) {
      return NextResponse.json(
        {
          error: limitStatus.reason || `Cooldown active for @${username}. Limit reached for ${option.label}.`,
          details: {
            usedLastHour: limitStatus.usedLastHour,
            remainingAllowed: limitStatus.remainingAllowed,
            cooldownSeconds: limitStatus.cooldownSeconds,
            cooldownFormatted: limitStatus.cooldownFormatted,
            dailyTriesUsed: limitStatus.dailyTriesUsed,
            dailyTriesRemaining: limitStatus.dailyTriesRemaining,
            dailyLimitReached: limitStatus.dailyLimitReached,
          },
        },
        { status: 429 }
      );
    }

    // 4. Create and dispatch order
    const order = await createOrder(username, amount);

    return NextResponse.json({
      success: true,
      message: `Minting initiated for @${username}`,
      order,
      dailyTriesRemaining: limitStatus.dailyTriesRemaining - 1,
    });
  } catch (error: any) {
    console.error("Fund API error:", error);
    return NextResponse.json(
      { error: "Internal server error processing minting" },
      { status: 500 }
    );
  }
}
