// Active site capacity and session tracker
// Enforces maximum 20 concurrent active users on the site.

interface ActiveSession {
  lastSeen: number;
  ip?: string;
}

const MAX_CAPACITY = 20;
const SESSION_TTL_MS = 25_000; // 25 seconds inactivity timeout

// In-memory active session map (survives across warm requests)
declare global {
  // eslint-disable-next-line no-var
  var _ozamaActiveSessions: Map<string, ActiveSession> | undefined;
}

if (!global._ozamaActiveSessions) {
  global._ozamaActiveSessions = new Map<string, ActiveSession>();
}

const sessions = global._ozamaActiveSessions;

function purgeExpiredSessions(now: number = Date.now()) {
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastSeen > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}

export const capacityTracker = {
  MAX_CAPACITY,

  /**
   * Pings or registers a session.
   * If existing or if active count < MAX_CAPACITY, allows entry.
   * Otherwise denies until a slot frees up.
   */
  heartbeat(sessionId: string, ip?: string): {
    allowed: boolean;
    activeCount: number;
    maxCapacity: number;
  } {
    const now = Date.now();
    purgeExpiredSessions(now);

    const isExisting = sessions.has(sessionId);

    if (isExisting) {
      sessions.set(sessionId, { lastSeen: now, ip });
      return {
        allowed: true,
        activeCount: sessions.size,
        maxCapacity: MAX_CAPACITY,
      };
    }

    // New visitor attempting to enter
    if (sessions.size < MAX_CAPACITY) {
      sessions.set(sessionId, { lastSeen: now, ip });
      return {
        allowed: true,
        activeCount: sessions.size,
        maxCapacity: MAX_CAPACITY,
      };
    }

    // Capacity full
    return {
      allowed: false,
      activeCount: sessions.size,
      maxCapacity: MAX_CAPACITY,
    };
  },

  release(sessionId: string): void {
    sessions.delete(sessionId);
  },

  getActiveCount(): number {
    purgeExpiredSessions();
    return sessions.size;
  },
};
