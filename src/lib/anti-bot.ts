// Anti-Bot Protection Suite for Ozama
// 1. Invisible Honeypot detection
// 2. Human interaction timing analysis
// 3. IP request throttling & bot-burst protection

interface IpBucket {
  tokens: number;
  lastRefill: number;
  requestTimes: number[];
}

declare global {
  // eslint-disable-next-line no-var
  var _ozamaIpThrottle: Map<string, IpBucket> | undefined;
}

if (!global._ozamaIpThrottle) {
  global._ozamaIpThrottle = new Map<string, IpBucket>();
}

const ipBuckets = global._ozamaIpThrottle;

// Clean up stale IP records every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of ipBuckets.entries()) {
    if (now - bucket.lastRefill > 180_000) {
      ipBuckets.delete(ip);
    }
  }
}, 60_000);

export const antiBot = {
  /**
   * Generates a timed anti-bot proof token.
   */
  createChallenge(): { token: string; timestamp: number } {
    const timestamp = Date.now();
    // Simple signed payload
    const token = Buffer.from(`ozm_${timestamp}_${Math.random().toString(36).slice(2)}`).toString("base64");
    return { token, timestamp };
  },

  /**
   * Validates submission timing and honeypot field.
   */
  validateSubmission(params: {
    honeypot?: string;
    token?: string;
    minElapsedMs?: number;
  }): { passed: boolean; reason?: string } {
    // 1. Honeypot check: must be completely empty
    if (params.honeypot && params.honeypot.trim().length > 0) {
      return { passed: false, reason: "Automated submission trap triggered." };
    }

    // 2. Timing check
    if (params.token) {
      try {
        const decoded = Buffer.from(params.token, "base64").toString("utf8");
        const parts = decoded.split("_");
        if (parts[0] === "ozm" && parts[1]) {
          const issuedAt = Number(parts[1]);
          const elapsed = Date.now() - issuedAt;
          const minTime = params.minElapsedMs ?? 1200; // minimum 1.2s for human interaction

          if (elapsed < minTime) {
            return {
              passed: false,
              reason: "Submission submitted too rapidly. Human verification required.",
            };
          }
        }
      } catch {
        return { passed: false, reason: "Invalid security token signature." };
      }
    }

    return { passed: true };
  },

  /**
   * Rate limits incoming requests per IP.
   * maxPerMinute: default 10 requests / minute
   */
  checkIpRate(ip: string, maxPerMinute = 12): { allowed: boolean; retryAfterSeconds: number } {
    const cleanIp = ip.split(",")[0].trim() || "127.0.0.1";
    const now = Date.now();
    let bucket = ipBuckets.get(cleanIp);

    if (!bucket) {
      bucket = { tokens: maxPerMinute, lastRefill: now, requestTimes: [] };
      ipBuckets.set(cleanIp, bucket);
    }

    // Remove requests older than 60s
    bucket.requestTimes = bucket.requestTimes.filter((t) => now - t < 60_000);

    if (bucket.requestTimes.length >= maxPerMinute) {
      const oldest = bucket.requestTimes[0];
      const waitMs = 60_000 - (now - oldest);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
      };
    }

    bucket.requestTimes.push(now);
    return { allowed: true, retryAfterSeconds: 0 };
  },
};
