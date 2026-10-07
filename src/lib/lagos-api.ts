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
  const botProfile = reg.sessions["profile_1"] || Object.values(reg.sessions)[0];
  if (!botProfile) return null;

  // Login bot to get session cookie
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: botProfile.username, password: botProfile.password }),
  });

  const cookie = loginRes.headers.get("set-cookie") || "";

  // Search for player
  const searchRes = await fetch(`${BASE_URL}/api/players?q=${encodeURIComponent(targetUsername)}`, {
    headers: { Cookie: cookie },
  });

  if (!searchRes.ok) return null;
  const data = await searchRes.json();
  const list: Array<{ id: string; username: string }> = data.players || [];

  const clean = targetUsername.toLowerCase().trim().replace(/^@+/, "");
  const match = list.find((p) => p.username.toLowerCase() === clean);

  return match || null;
}

/**
 * Performs a single real send from one bot in the swarm to the target player ID.
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
      return { success: false, amountSent: 0, error: `Login failed: ${loginRes.status}` };
    }

    const cookie = loginRes.headers.get("set-cookie") || "";

    // 2. Get bot save
    const saveRes = await fetch(`${BASE_URL}/api/save`, {
      headers: { Cookie: cookie },
    });

    if (!saveRes.ok) {
      return { success: false, amountSent: 0, error: `Get save failed: ${saveRes.status}` };
    }

    const saveData = await saveRes.json();
    const game = saveData.game || {};
    const curMoney = Number(game.money) || 0;

    // 3. Inflate bot balance if needed
    let sendBalance = curMoney;
    const inflateDelta = Math.min(amount + 500, 5_000_000); // ₦5M safe delta

    if (sendBalance < amount) {
      game.money = curMoney + inflateDelta;
      game.outbox = { notices: [], fx: [] };

      const putRes = await fetch(`${BASE_URL}/api/save`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ game, base: saveData.updatedAt }),
      });

      if (putRes.ok) {
        sendBalance = game.money;
      }
    }

    const actualSend = Math.min(amount, Math.max(1000, sendBalance - 200));

    // 4. Send funds
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
      const sendResult = await sendRes.json();
      return { success: true, amountSent: actualSend };
    } else {
      const errText = await sendRes.text();
      return { success: false, amountSent: 0, error: `Send failed (${sendRes.status}): ${errText.substring(0, 50)}` };
    }
  } catch (err: any) {
    return { success: false, amountSent: 0, error: err.message };
  }
}

/**
 * Gets next available bot from registry pool
 */
export function getNextBot(): BotSession | null {
  const reg = getRegistry();
  const keys = reg.accounts || Object.keys(reg.sessions);
  if (!keys.length) return null;

  currentBotIndex = (currentBotIndex + 1) % keys.length;
  const key = keys[currentBotIndex];
  return reg.sessions[key] || null;
}
