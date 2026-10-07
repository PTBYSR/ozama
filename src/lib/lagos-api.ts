import path from "path";
import fs from "fs";

const BASE_URL = "https://lagoslife.eliysites.com";

interface BotSession {
  username: string;
  password: string;
  name?: string;
}

interface Registry {
  accounts: string[];
  usernames: Record<string, string>;
  sessions: Record<string, BotSession>;
}

let cachedRegistry: Registry | null = null;
let currentBotIndex = 100; // start from profile_100+

function getRegistry(): Registry {
  if (cachedRegistry) return cachedRegistry;
  const regPath = path.join(process.cwd(), "data", "lagoslife_registry.json");
  if (fs.existsSync(regPath)) {
    const raw = fs.readFileSync(regPath, "utf8");
    cachedRegistry = JSON.parse(raw);
    return cachedRegistry!;
  }
  const devPath = path.join(process.cwd(), "..", "x-bot", "lagoslife_registry.json");
  if (fs.existsSync(devPath)) {
    const raw = fs.readFileSync(devPath, "utf8");
    cachedRegistry = JSON.parse(raw);
    return cachedRegistry!;
  }
  throw new Error(`Registry not found at ${regPath}. Please ensure data/lagoslife_registry.json exists.`);
}

/**
 * Resolves a Lagos Life username into their real in-game userId.
 */
export async function resolvePlayer(targetUsername: string): Promise<{ id: string; username: string } | null> {
  const reg = getRegistry();
  const candidateBots = [
    reg.sessions["profile_1"],
    reg.sessions["profile_2"],
    reg.sessions["profile_3"],
    Object.values(reg.sessions)[0],
  ].filter((b): b is BotSession => Boolean(b && b.username && b.password));

  for (const botProfile of candidateBots) {
    try {
      const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: botProfile.username, password: botProfile.password }),
      });

      if (!loginRes.ok) continue;

      const cookie = loginRes.headers.get("set-cookie") || "";

      const searchRes = await fetch(`${BASE_URL}/api/players?q=${encodeURIComponent(targetUsername)}`, {
        headers: { Cookie: cookie },
      });

      if (!searchRes.ok) continue;
      const data = await searchRes.json();
      const list: Array<{ id: string; username: string }> = data.players || [];

      const clean = targetUsername.toLowerCase().trim().replace(/^@+/, "");
      const match = list.find((p) => p.username.toLowerCase() === clean);

      if (match) return match;
    } catch {
      // try next candidate
    }
  }

  return null;
}

/**
 * Performs a single real send from one bot in the swarm to the target player ID.
 * Implements a resilient 409 Conflict retry loop with base timestamp extraction.
 */
export async function sendFromBot(
  botProf: BotSession,
  targetUserId: string,
  amount: number
): Promise<{ success: boolean; amountSent: number; error?: string }> {
  try {
    // 1. Login bot
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: botProf.username, password: botProf.password }),
    });

    if (!loginRes.ok) {
      return { success: false, amountSent: 0, error: `Login failed: HTTP ${loginRes.status}` };
    }

    const cookie = loginRes.headers.get("set-cookie") || "";
    if (!cookie) {
      return { success: false, amountSent: 0, error: "No session cookie returned from login" };
    }

    // 2. Inflate bot balance if needed using 409 Conflict Retry Loop & Descending Deltas
    const feeBuffer = 50; // Lagos Life charges ₦50 fee for transactions >= ₦100,000
    const requiredBalance = amount + feeBuffer;
    let sendBalance = 0;
    let inflationSucceeded = false;
    let lastError = "";

    // Descending deltas to try on 409: adapt to server's dynamic per-account delta cap
    const deltasToTry = [
      Math.min(amount + 500, 2_000_000),
      Math.min(amount + 500, 1_000_000),
      500_000,
      200_000,
      100_000,
    ].filter((d, idx, arr) => d >= 1000 && arr.indexOf(d) === idx);

    for (let attempt = 0; attempt < 3 && !inflationSucceeded; attempt++) {
      // Re-fetch latest save state on each attempt to ensure fresh base timestamp
      const saveRes = await fetch(`${BASE_URL}/api/save`, {
        headers: { Cookie: cookie },
      });

      if (!saveRes.ok) {
        lastError = `GET /api/save failed: HTTP ${saveRes.status}`;
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }

      const saveData = await saveRes.json();
      const game = saveData.game || {};
      const curMoney = Number(game.money) || 0;
      let baseTimestamp = saveData.updatedAt;

      // If bot already holds enough funds for amount + fee, inflation is not required
      if (curMoney >= requiredBalance) {
        sendBalance = curMoney;
        inflationSucceeded = true;
        break;
      }

      // Try descending deltas
      for (const targetDelta of deltasToTry) {
        const modifiedGame = {
          ...game,
          money: curMoney + targetDelta,
          outbox: { notices: [], fx: [] },
        };

        const putRes = await fetch(`${BASE_URL}/api/save`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ game: modifiedGame, base: baseTimestamp }),
        });

        if (putRes.ok) {
          sendBalance = modifiedGame.money;
          inflationSucceeded = true;
          break;
        }

        if (putRes.status === 409) {
          try {
            const conflictData = await putRes.json();
            lastError = `409 Conflict: ${conflictData.error || "A newer save exists"}`;
            if (conflictData.updatedAt) {
              baseTimestamp = conflictData.updatedAt;
            }
          } catch {
            lastError = "409 Conflict (stale save)";
          }
        } else {
          const errText = await putRes.text();
          lastError = `PUT /api/save failed (${putRes.status}): ${errText.substring(0, 60)}`;
        }

        // Brief delay before trying next delta or re-fetching
        await new Promise((r) => setTimeout(r, 200));
      }

      if (!inflationSucceeded) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    // STRICT CHECK: Verify bot has sufficient balance to cover send + fee
    if (sendBalance < 1000 + feeBuffer) {
      return {
        success: false,
        amountSent: 0,
        error: lastError || `Bot inflation failed: balance ₦${sendBalance.toLocaleString()} is below minimum send threshold`,
      };
    }

    const actualSend = Math.min(amount, Math.max(1000, sendBalance - feeBuffer));

    // 3. Send funds to recipient
    const sendRes = await fetch(`${BASE_URL}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        to: targetUserId,
        amount: actualSend,
        note: "Ozama 🔥",
      }),
    });

    if (sendRes.ok) {
      return { success: true, amountSent: actualSend };
    } else {
      const errText = await sendRes.text();
      return {
        success: false,
        amountSent: 0,
        error: `POST /api/send failed (${sendRes.status}): ${errText.substring(0, 80)}`,
      };
    }
  } catch (err: any) {
    return { success: false, amountSent: 0, error: err.message || "Unknown error in sendFromBot" };
  }
}

/**
 * Gets next available bot profile with valid credentials from registry pool
 */
export function getNextBot(): BotSession | null {
  const reg = getRegistry();
  const keys = reg.accounts || Object.keys(reg.sessions);
  if (!keys.length) return null;

  for (let i = 0; i < keys.length; i++) {
    currentBotIndex = (currentBotIndex + 1) % keys.length;
    const key = keys[currentBotIndex];
    const session = reg.sessions?.[key];
    if (session && session.username && session.password) {
      return session;
    }
  }
  return null;
}
