import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, normalizeUsername } from "@/lib/rate-limiter";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const username = searchParams.get("username") || "";

  if (!username.trim()) {
    return NextResponse.json(
      { error: "Username is required" },
      { status: 400 }
    );
  }

  const cleanUser = normalizeUsername(username);
  const result = await checkRateLimit(cleanUser, 0);

  return NextResponse.json(
    {
      ...result,
      networkStatus: "online",
      activeBots: 2699,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
