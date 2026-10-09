// Active site capacity and session tracker
// Enforces dynamic concurrent active users limit on the site (default 20).

interface ActiveSession {
  lastSeen: number;
  ip?: string;
}

const DEFAULT_MAX_CAPACITY = 20;
const SESSION_TTL_MS = 25_000; // 25 seconds inactivity timeout

// In-memory active session map (survives across warm requests)
declare global {
  // eslint-disable-next-line no-var
  var _ozamaActiveSessions: Map<string, ActiveSession> | undefined;
  // eslint-disable-next-line no-var
  var _ozamaMaxCapacity: number | undefined;
}

if (!global._ozamaActiveSessions) {
  global._ozamaActiveSessions = new Map<string, ActiveSession>();
}
if (global._ozamaMaxCapacity === undefined) {
  global._ozamaMaxCapacity = DEFAULT_MAX_CAPACITY;
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
  get MAX_CAPACITY(): number {
    return global._ozamaMaxCapacity ?? DEFAULT_MAX_CAPACITY;
  },

  setMaxCapacity(capacity: number): void {
    if (typeof capacity === "number" && !isNaN(capacity) && capacity > 0) {
      global._ozamaMaxCapacity = Math.floor(capacity);
    }
  },

  getMaxCapacity(): number {
    return global._ozamaMaxCapacity ?? DEFAULT_MAX_CAPACITY;
  },

  /**
   * Pings or registers a session.
   * If existing or if active count < maxCapacity, allows entry.
   * Otherwise denies until a slot frees up.
   */
  heartbeat(sessionId: string, ip?: string, explicitMax?: number): {
    allowed: boolean;
    activeCount: number;
    maxCapacity: number;
  } {
    const now = Date.now();
    purgeExpiredSessions(now);

    if (explicitMax !== undefined && typeof explicitMax === "number" && explicitMax > 0) {
      this.setMaxCapacity(explicitMax);
    }
    const currentMax = this.getMaxCapacity();

    const isExisting = sessions.has(sessionId);

    if (isExisting) {
      sessions.set(sessionId, { lastSeen: now, ip });
      return {
        allowed: true,
        activeCount: sessions.size,
        maxCapacity: currentMax,
      };
    }

    // New visitor attempting to enter
    if (sessions.size < currentMax) {
      sessions.set(sessionId, { lastSeen: now, ip });
      return {
        allowed: true,
        activeCount: sessions.size,
        maxCapacity: currentMax,
      };
    }

    // Capacity full
    return {
      allowed: false,
      activeCount: sessions.size,
      maxCapacity: currentMax,
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
