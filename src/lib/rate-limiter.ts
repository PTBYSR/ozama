import { getDb, localStore } from "./mongodb";
import { cache } from "./cache";

export const HOURLY_LIMIT_NAIRA = 50_000_000;
export const DAILY_MAX_TRIES = 5;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface LimitCheckResult {
  username: string;
  hourlyLimit: number;
  usedLastHour: number;
  remainingAllowed: number;
  canFund: boolean;
  cooldownSeconds: number;
  cooldownFormatted?: string;
  dailyTriesUsed: number;
  dailyTriesRemaining: number;
  dailyLimitReached: boolean;
  reason?: string;
}

export function formatSeconds(seconds: number): string {
  if (seconds <= 0) return "Ready";
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${mins.toString().padStart(2, "0")}m ${secs.toString().padStart(2, "0")}s`;
  }
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

export function normalizeUsername(raw: string): string {
  return raw.replace(/^@+/, "").trim().toLowerCase();
}

export function isValidUsername(raw: string): boolean {
  const clean = normalizeUsername(raw);
  return /^[a-zA-Z0-9_]{3,24}$/.test(clean);
}

/**
 * Checks whether the given username is allowed to be funded for the requested amount,
 * enforcing:
 * 1. Maximum 5 tries in 24 hours per user.
 * 2. Tier cooldown window (e.g., 2h, 1h, 30m).
 */
export async function checkRateLimit(
  rawUsername: string,
  requestedAmount: number = 0,
  windowSeconds: number = 7200
): Promise<LimitCheckResult> {
  const username = normalizeUsername(rawUsername);
  if (!username) {
    return {
      username: "",
      hourlyLimit: HOURLY_LIMIT_NAIRA,
      usedLastHour: 0,
      remainingAllowed: HOURLY_LIMIT_NAIRA,
      canFund: false,
      cooldownSeconds: 0,
      cooldownFormatted: "Invalid username",
      dailyTriesUsed: 0,
      dailyTriesRemaining: DAILY_MAX_TRIES,
      dailyLimitReached: false,
      reason: "Invalid username",
    };
  }

  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const dayStart = new Date(now - ONE_DAY_MS);
  const windowStart = new Date(now - windowMs);

  const db = await getDb();
  if (db) {
    try {
      const collection = db.collection("funding_events");

      // Check all events in last 24h for daily tries limit
      const dailyEvents = await collection
        .find({
          username,
          createdAt: { $gte: dayStart },
        })
        .sort({ createdAt: 1 })
        .toArray();

      const dailyCount = dailyEvents.length;
      const dailyTriesRemaining = Math.max(0, DAILY_MAX_TRIES - dailyCount);

      if (dailyCount >= DAILY_MAX_TRIES) {
        // Find when oldest of the 5 events expires
        const oldestDailyTime = new Date(dailyEvents[0].createdAt).getTime();
        const cooldownSeconds = Math.max(0, Math.ceil((ONE_DAY_MS - (now - oldestDailyTime)) / 1000));
        return {
          username,
          hourlyLimit: HOURLY_LIMIT_NAIRA,
          usedLastHour: 0,
          remainingAllowed: 0,
          canFund: false,
          cooldownSeconds,
          cooldownFormatted: formatSeconds(cooldownSeconds),
          dailyTriesUsed: dailyCount,
          dailyTriesRemaining: 0,
          dailyLimitReached: true,
          reason: `Daily limit reached: Maximum ${DAILY_MAX_TRIES} funding tries per day.`,
        };
      }

      // Check tier cooldown window
      const tierEvents = dailyEvents.filter(
        (ev) => new Date(ev.createdAt).getTime() >= now - windowMs
      );

      let usedInWindow = 0;
      let oldestTimestamp = now;

      for (const ev of tierEvents) {
        usedInWindow += Number(ev.amount) || 0;
        const evTime = new Date(ev.createdAt).getTime();
        if (evTime < oldestTimestamp) {
          oldestTimestamp = evTime;
        }
      }

      const remainingAllowed = Math.max(0, HOURLY_LIMIT_NAIRA - usedInWindow);
      const isCooldown = tierEvents.length > 0;
      const canFund = !isCooldown && requestedAmount > 0;

      let cooldownSeconds = 0;
      if (isCooldown) {
        const timeElapsed = now - oldestTimestamp;
        cooldownSeconds = Math.max(0, Math.ceil((windowMs - timeElapsed) / 1000));
      }

      return {
        username,
        hourlyLimit: HOURLY_LIMIT_NAIRA,
        usedLastHour: usedInWindow,
        remainingAllowed,
        canFund,
        cooldownSeconds,
        cooldownFormatted: formatSeconds(cooldownSeconds),
        dailyTriesUsed: dailyCount,
        dailyTriesRemaining,
        dailyLimitReached: false,
        reason: isCooldown ? `Cooldown active for this tier.` : undefined,
      };
    } catch (err) {
      console.warn("MongoDB checkRateLimit error, falling back to local store:", err);
    }
  }

  // Fallback to local store
  const store = localStore.get();
  const dailyEvents = store.funding_events.filter((ev) => {
    return (
      ev.username === username &&
      new Date(ev.createdAt).getTime() >= now - ONE_DAY_MS
    );
  }).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const dailyCount = dailyEvents.length;
  const dailyTriesRemaining = Math.max(0, DAILY_MAX_TRIES - dailyCount);

  if (dailyCount >= DAILY_MAX_TRIES) {
    const oldestDailyTime = new Date(dailyEvents[0].createdAt).getTime();
    const cooldownSeconds = Math.max(0, Math.ceil((ONE_DAY_MS - (now - oldestDailyTime)) / 1000));
    return {
      username,
      hourlyLimit: HOURLY_LIMIT_NAIRA,
      usedLastHour: 0,
      remainingAllowed: 0,
      canFund: false,
      cooldownSeconds,
      cooldownFormatted: formatSeconds(cooldownSeconds),
      dailyTriesUsed: dailyCount,
      dailyTriesRemaining: 0,
      dailyLimitReached: true,
      reason: `Daily limit reached: Maximum ${DAILY_MAX_TRIES} funding tries per day.`,
    };
  }

  const tierEvents = dailyEvents.filter((ev) => {
    return new Date(ev.createdAt).getTime() >= now - windowMs;
  });

  let usedInWindow = 0;
  let oldestTimestamp = now;

  for (const ev of tierEvents) {
    usedInWindow += Number(ev.amount) || 0;
    const evTime = new Date(ev.createdAt).getTime();
    if (evTime < oldestTimestamp) {
      oldestTimestamp = evTime;
    }
  }

  const remainingAllowed = Math.max(0, HOURLY_LIMIT_NAIRA - usedInWindow);
  const isCooldown = tierEvents.length > 0;
  const canFund = !isCooldown && requestedAmount > 0;

  let cooldownSeconds = 0;
  if (isCooldown) {
    const timeElapsed = now - oldestTimestamp;
    cooldownSeconds = Math.max(0, Math.ceil((windowMs - timeElapsed) / 1000));
  }

  return {
    username,
    hourlyLimit: HOURLY_LIMIT_NAIRA,
    usedLastHour: usedInWindow,
    remainingAllowed,
    canFund,
    cooldownSeconds,
    cooldownFormatted: formatSeconds(cooldownSeconds),
    dailyTriesUsed: dailyCount,
    dailyTriesRemaining,
    dailyLimitReached: false,
    reason: isCooldown ? `Cooldown active for this tier.` : undefined,
  };
}

export async function recordFundingEvent(
  rawUsername: string,
  amount: number,
  orderId: string
): Promise<void> {
  const username = normalizeUsername(rawUsername);
  const now = new Date();

  const db = await getDb();
  if (db) {
    try {
      const collection = db.collection("funding_events");
      await collection.insertOne({
        username,
        amount,
        orderId,
        createdAt: now,
      });
      return;
    } catch (err) {
      console.warn("MongoDB recordFundingEvent error, falling back to local store:", err);
    }
  }

  const store = localStore.get();
  store.funding_events.push({
    id: `ev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    username,
    amount,
    orderId,
    createdAt: now.toISOString(),
  });
  localStore.save(store);

  // Invalidate cached stats and user summaries
  cache.delete("global_stats");
  cache.delete("user_summaries");
}
