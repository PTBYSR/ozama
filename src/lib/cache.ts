/**
 * In-Memory Caching System with TTL and Tag/Key Invalidation
 * Designed for serverless Next.js edge and node runtimes.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class MemoryCache {
  private store: Map<string, CacheEntry<any>> = new Map();

  /**
   * Retrieve cached item if not expired
   */
  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  /**
   * Set cache entry with Time-To-Live in milliseconds
   */
  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Invalidate a single key
   */
  delete(key: string): void {
    this.store.delete(key);
  }

  /**
   * Invalidate multiple keys by prefix (e.g., "order:" or "stats")
   */
  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Helper to get or compute value with cache
   */
  async getOrSet<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }
    const fresh = await fetcher();
    if (fresh !== null && fresh !== undefined) {
      this.set(key, fresh, ttlMs);
    }
    return fresh;
  }
}

// Preserve cache across hot-reloads in development and serverless invocations
declare global {
  // eslint-disable-next-line no-var
  var _ozamaCache: MemoryCache | undefined;
}

export const cache = global._ozamaCache || new MemoryCache();
if (process.env.NODE_ENV !== "production") {
  global._ozamaCache = cache;
}

export const CACHE_TTL = {
  SYSTEM_STATUS: 4000,    // 4 seconds (ultra-fast for polling clients)
  RECENT_ORDERS: 6000,    // 6 seconds
  STATS: 10000,           // 10 seconds
  USER_SUMMARIES: 10000,  // 10 seconds
  ORDER_LOOKUP: 3000,     // 3 seconds
};
