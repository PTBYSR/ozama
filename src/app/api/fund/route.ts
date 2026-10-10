import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, normalizeUsername, isValidUsername } from "@/lib/rate-limiter";
import { createOrder } from "@/lib/orders";
import { antiBot } from "@/lib/anti-bot";
import { dbAdapter, getDb, localStore } from "@/lib/mongodb";

export const maxDuration = 60;

const ALLOWED_OPTIONS: Record<number, { windowSeconds: number; label: string }> = {
  50_000_000: { windowSeconds: 7200, label: "50M (2 Hours)" },
  25_000_000: { windowSeconds: 3600, label: "25M (1 Hour)" },
  10_000_000: { windowSeconds: 1800, label: "10M (30 Min)" },
};

export async function POST(req: NextRequest) {
  try {
    // 0. Extract Client IP
    const rawIp = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "127.0.0.1";
    const ip = rawIp.split(",")[0].trim();

    // 1. IP Ban Enforcement: Immediate rejection if IP is blocked
    if (await dbAdapter.isIpBlocked(ip)) {
      return NextResponse.json(
        { error: "Access denied. Your IP address has been restricted by administrators." },
        { status: 403 }
      );
    }

    // 2. Global Kill Switch & System Activity Check
    const settings = await dbAdapter.getSystemSettings();
    if (settings.killSwitch || !settings.isLive) {
      return NextResponse.json(
        {
          error: settings.killSwitchMessage || settings.maintenanceMessage || "Ozama is currently offline for system maintenance.",
        },
        { status: 503 }
      );
    }

    // 3. Anti-Bot IP rate check (max 8 fundings attempted per min per IP)
    const ipCheck = antiBot.checkIpRate(ip, 8);
    if (!ipCheck.allowed) {
      return NextResponse.json(
        { error: `Too many attempts from your network. Please wait ${ipCheck.retryAfterSeconds}s and try again.` },
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
        { error: "Security check failed. Please refresh the page and try again." },
        { status: 403 }
      );
    }

    const rawUsername = body.username || "";
    const amount = Number(body.amount);

    const username = normalizeUsername(rawUsername);

    if (!isValidUsername(username)) {
      return NextResponse.json(
        { error: "Invalid username. Lagos Life usernames are 3–24 characters (letters, numbers, underscores)." },
        { status: 400 }
      );
    }

    const option = ALLOWED_OPTIONS[amount];
    if (!option) {
      return NextResponse.json(
        { error: "Please select a funding option (50M, 25M, or 10M)." },
        { status: 400 }
      );
    }

    // 3. Check rate limits FIRST (In-Flight Order Lock, Daily 5 tries limit & Tier cooldown window)
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

    // 4. Auto-clean stale abandoned orders (>90s) & check live Swarm Concurrency
    await dbAdapter.cleanupStaleOrders(90);

    const db = await getDb();
    let activeSwarmCount = 0;
    const activeCutoff = new Date(Date.now() - 90 * 1000).toISOString();
    if (db) {
      activeSwarmCount = await db.collection("orders").countDocuments({
        status: { $in: ["queued", "authenticating", "allocating", "streaming"] },
        updatedAt: { $gte: activeCutoff },
      });
    } else {
      activeSwarmCount = localStore.get().orders.filter((o) =>
        ["queued", "authenticating", "allocating", "streaming"].includes(o.status) &&
        Date.now() - new Date(o.updatedAt || o.createdAt).getTime() <= 90 * 1000
      ).length;
    }

    if (activeSwarmCount >= 5) {
      return NextResponse.json(
        {
          error: "The swarm is currently busy funding other accounts. Please wait small and try again.",
        },
        { status: 503 }
      );
    }

    // 5. Create and dispatch order
    const order = await createOrder(username, amount, ip);

    return NextResponse.json({
      success: true,
      message: `Funding initiated for @${username}`,
      order,
      dailyTriesRemaining: limitStatus.dailyTriesRemaining - 1,
    });
  } catch (error: any) {
    console.error("Fund API error:", error);
    return NextResponse.json(
      { error: "Could not start funding right now. Please try again in a moment." },
      { status: 500 }
    );
  }
}
