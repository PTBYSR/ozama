import { MongoClient, Db } from "mongodb";
import fs from "fs";
import path from "path";
import { OrderDoc, FundingLogDoc, SystemSettings, UserSummary } from "./types";
import { cache, CACHE_TTL } from "./cache";

const defaultAtlasUri =
  "mongodb+srv://garygresham23_db_user:garygresham23_db_user_new@aq81bxg.mongodb.net/ozama?authSource=admin&retryWrites=true&w=majority";

const rawEnvUri = (process.env.MONGODB_URI || "").trim();
// Ignore expired/broken legacy 'babani' cluster that causes SSL errors on Vercel
const uri =
  rawEnvUri && !rawEnvUri.includes("babani") ? rawEnvUri : defaultAtlasUri;
const dbName = process.env.MONGODB_DB || "ozama";

let hasSeededFromLocal = false;
let lastError: string | null = null;

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

export function getDbDiagnostics() {
  return {
    hasEnvUri: !!process.env.MONGODB_URI,
    activeDbName: dbName,
    activeUriPrefix: uri ? uri.substring(0, 20) + "..." : "none",
    lastError,
  };
}

export async function getDb(): Promise<Db | null> {
  if (!uri) return null;
  try {
    if (!global._mongoClientPromise) {
      const mc = new MongoClient(uri, {
        serverSelectionTimeoutMS: 6000,
        connectTimeoutMS: 6000,
        maxPoolSize: 5,
        minPoolSize: 0,
      });
      global._mongoClientPromise = mc.connect().catch((err) => {
        global._mongoClientPromise = undefined;
        throw err;
      });
    }

    const connectedClient = await global._mongoClientPromise;
    const db = connectedClient.db(dbName);

    // Initial check: Seed MongoDB Atlas if collections are freshly created
    if (!hasSeededFromLocal) {
      hasSeededFromLocal = true;
      seedMongoIfEmpty(db).catch((err) =>
        console.warn("MongoDB initial seed error (non-fatal):", err)
      );
    }

    lastError = null;
    return db;
  } catch (error: any) {
    global._mongoClientPromise = undefined;
    lastError = error?.message || String(error);
    console.warn("MongoDB connection failed, falling back to local store:", lastError);
    return null;
  }
}

// -------------------------------------------------------------
// Fallback Local File Store (used only if MongoDB is unreachable)
// -------------------------------------------------------------
const isVercel = !!process.env.VERCEL;
const DATA_DIR = isVercel ? "/tmp/ozama_data" : path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "ozama.json");

interface LocalStore {
  orders: OrderDoc[];
  funding_events: Array<{
    id: string;
    username: string;
    amount: number;
    orderId: string;
    createdAt: string;
  }>;
  settings?: SystemSettings;
}

let inMemoryStore: LocalStore = {
  orders: [],
  funding_events: [],
  settings: {
    isLive: true,
    maintenanceMessage: "",
    updatedAt: new Date().toISOString(),
  },
};

function ensureDataFile(): LocalStore {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(inMemoryStore, null, 2), "utf8");
      return inMemoryStore;
    }
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    inMemoryStore = JSON.parse(raw);
    return inMemoryStore;
  } catch {
    return inMemoryStore;
  }
}

function saveLocalStore(store: LocalStore) {
  inMemoryStore = store;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch (err) {
    console.warn("LocalStore file write skipped (read-only environment):", err);
  }
}

export const localStore = {
  get: ensureDataFile,
  save: saveLocalStore,
};

async function seedMongoIfEmpty(db: Db) {
  try {
    const ordersCount = await db.collection("orders").countDocuments();
    if (ordersCount === 0) {
      const local = ensureDataFile();
      if (local.orders && local.orders.length > 0) {
        await db.collection("orders").insertMany(local.orders as any);
        console.log(`[DB] Seeded ${local.orders.length} orders into MongoDB Atlas.`);
      }
      if (local.funding_events && local.funding_events.length > 0) {
        await db.collection("funding_events").insertMany(local.funding_events as any);
        console.log(`[DB] Seeded ${local.funding_events.length} funding events into MongoDB Atlas.`);
      }
      if (local.settings) {
        await db
          .collection("settings")
          .updateOne({ id: "system_status" }, { $set: local.settings }, { upsert: true });
      }
    }
  } catch (e) {
    console.warn("[DB] Seeding skipped:", e);
  }
}

// -------------------------------------------------------------
// Universal dbAdapter (Database first + Multi-Tier Cache)
// -------------------------------------------------------------
export const dbAdapter = {
  async getOrder(orderId: string): Promise<OrderDoc | null> {
    const cacheKey = `order:${orderId}`;
    return await cache.getOrSet(cacheKey, CACHE_TTL.ORDER_LOOKUP, async () => {
      const db = await getDb();
      if (db) {
        try {
          const doc = await db.collection("orders").findOne({ id: orderId });
          if (doc) {
            // Remove Mongo _id before returning
            const { _id, ...clean } = doc as any;
            return clean as OrderDoc;
          }
        } catch (err) {
          console.warn("MongoDB getOrder error:", err);
        }
      }
      const store = localStore.get();
      return store.orders.find((o) => o.id === orderId) || null;
    });
  },

  async updateOrder(orderId: string, update: Partial<OrderDoc>): Promise<void> {
    const now = new Date().toISOString();
    const db = await getDb();
    if (db) {
      try {
        await db.collection("orders").updateOne(
          { id: orderId },
          { $set: { ...update, updatedAt: now } }
        );
      } catch (err) {
        console.warn("MongoDB updateOrder error:", err);
      }
    }

    const store = localStore.get();
    const idx = store.orders.findIndex((o) => o.id === orderId);
    if (idx !== -1) {
      store.orders[idx] = {
        ...store.orders[idx],
        ...update,
        updatedAt: now,
      };
      localStore.save(store);
    }

    // Invalidate caches
    cache.delete(`order:${orderId}`);
    cache.invalidatePrefix("recent_orders");
    cache.invalidatePrefix("all_orders");
    cache.delete("user_summaries");
    cache.delete("global_stats");
  },

  async recordFundingLog(log: FundingLogDoc): Promise<void> {
    const db = await getDb();
    if (db) {
      try {
        await db.collection("funding_events").insertOne({
          id: log.id,
          username: log.username,
          amount: log.amount,
          orderId: log.orderId,
          createdAt: new Date(log.timestamp),
        });
      } catch (err) {
        console.warn("MongoDB recordFundingLog error:", err);
      }
    }

    const store = localStore.get();
    store.funding_events.push({
      id: log.id,
      username: log.username,
      amount: log.amount,
      orderId: log.orderId,
      createdAt: log.timestamp,
    });
    localStore.save(store);

    // Invalidate aggregated caches
    cache.delete("global_stats");
    cache.delete("user_summaries");
  },

  async createOrder(order: OrderDoc): Promise<OrderDoc> {
    const db = await getDb();
    if (db) {
      try {
        await db.collection("orders").insertOne({ ...order });
      } catch (err) {
        console.warn("MongoDB createOrder error:", err);
      }
    }

    const store = localStore.get();
    store.orders.unshift(order);
    localStore.save(store);

    // Warm cache and invalidate lists
    cache.set(`order:${order.id}`, order, CACHE_TTL.ORDER_LOOKUP);
    cache.invalidatePrefix("recent_orders");
    cache.invalidatePrefix("all_orders");
    cache.delete("user_summaries");

    return order;
  },

  async getRecentOrders(limit = 6): Promise<OrderDoc[]> {
    const cacheKey = `recent_orders:${limit}`;
    return await cache.getOrSet(cacheKey, CACHE_TTL.RECENT_ORDERS, async () => {
      const db = await getDb();
      if (db) {
        try {
          const docs = await db
            .collection("orders")
            .find({ status: { $in: ["completed", "streaming", "allocating"] } })
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();
          return docs.map(({ _id, ...doc }: any) => doc as OrderDoc);
        } catch (err) {
          console.warn("MongoDB getRecentOrders error:", err);
        }
      }
      const store = localStore.get();
      return store.orders.slice(0, limit);
    });
  },

  async getAllOrders(limit = 100): Promise<OrderDoc[]> {
    const cacheKey = `all_orders:${limit}`;
    return await cache.getOrSet(cacheKey, CACHE_TTL.RECENT_ORDERS, async () => {
      const db = await getDb();
      if (db) {
        try {
          const docs = await db
            .collection("orders")
            .find({})
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();
          return docs.map(({ _id, ...doc }: any) => doc as OrderDoc);
        } catch (err) {
          console.warn("MongoDB getAllOrders error:", err);
        }
      }
      const store = localStore.get();
      return store.orders.slice(0, limit);
    });
  },

  async getSystemSettings(): Promise<SystemSettings> {
    const cacheKey = "system_settings";
    return await cache.getOrSet(cacheKey, CACHE_TTL.SYSTEM_STATUS, async () => {
      const db = await getDb();
      if (db) {
        try {
          const doc = await db.collection("settings").findOne({ id: "system_status" });
          if (doc) {
            return {
              isLive: doc.isLive ?? true,
              maintenanceMessage: doc.maintenanceMessage || "",
              updatedAt: doc.updatedAt || new Date().toISOString(),
            };
          }
        } catch (err) {
          console.warn("MongoDB getSystemSettings error:", err);
        }
      }
      const store = localStore.get();
      if (!store.settings) {
        store.settings = {
          isLive: true,
          maintenanceMessage: "",
          updatedAt: new Date().toISOString(),
        };
        localStore.save(store);
      }
      return store.settings;
    });
  },

  async updateSystemSettings(update: Partial<SystemSettings>): Promise<SystemSettings> {
    const now = new Date().toISOString();
    const db = await getDb();
    if (db) {
      try {
        await db.collection("settings").updateOne(
          { id: "system_status" },
          { $set: { ...update, updatedAt: now } },
          { upsert: true }
        );
      } catch (err) {
        console.warn("MongoDB updateSystemSettings error:", err);
      }
    }

    const store = localStore.get();
    const current = store.settings || { isLive: true, maintenanceMessage: "", updatedAt: now };
    store.settings = {
      isLive: update.isLive !== undefined ? update.isLive : current.isLive,
      maintenanceMessage:
        update.maintenanceMessage !== undefined
          ? update.maintenanceMessage
          : current.maintenanceMessage,
      updatedAt: now,
    };
    localStore.save(store);

    // Invalidate and refresh cache immediately
    cache.delete("system_settings");
    cache.set("system_settings", store.settings, CACHE_TTL.SYSTEM_STATUS);

    return store.settings;
  },

  async getUserSummaries(): Promise<UserSummary[]> {
    const cacheKey = "user_summaries";
    return await cache.getOrSet(cacheKey, CACHE_TTL.USER_SUMMARIES, async () => {
      const orders = await this.getAllOrders(500);
      const userMap = new Map<string, UserSummary>();

      for (const order of orders) {
        const cleanUser = (order.username || "").toLowerCase().trim();
        if (!cleanUser) continue;

        let entry = userMap.get(cleanUser);
        if (!entry) {
          entry = {
            username: order.username,
            totalFunded: 0,
            totalOrders: 0,
            completedOrders: 0,
            failedOrders: 0,
            lastActive: order.createdAt,
            lastStatus: order.status,
          };
          userMap.set(cleanUser, entry);
        }

        entry.totalOrders += 1;
        if (order.status === "completed") {
          entry.completedOrders += 1;
          entry.totalFunded += order.amountDelivered || order.amount || 0;
        } else if (order.status === "failed") {
          entry.failedOrders += 1;
        }

        if (new Date(order.createdAt) >= new Date(entry.lastActive)) {
          entry.lastActive = order.createdAt;
          entry.lastStatus = order.status;
        }
      }

      return Array.from(userMap.values()).sort(
        (a, b) => new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime()
      );
    });
  },

  getStats: getGlobalStats,
};

export async function getGlobalStats(): Promise<{ totalAmount: number; totalPlayers: number }> {
  const cacheKey = "global_stats";
  return await cache.getOrSet(cacheKey, CACHE_TTL.STATS, async () => {
    const db = await getDb();
    if (db) {
      try {
        const events = await db.collection("funding_events").find({}).toArray();
        let totalAmount = 0;
        const playersSet = new Set<string>();
        for (const ev of events) {
          totalAmount += Number(ev.amount) || 0;
          if (ev.username) playersSet.add(ev.username.toLowerCase());
        }

        // If funding_events is still empty, aggregate from completed orders in DB
        if (totalAmount === 0) {
          const completedOrders = await db
            .collection("orders")
            .find({ status: "completed" })
            .toArray();
          for (const o of completedOrders) {
            totalAmount += Number(o.amount) || 0;
            if (o.username) playersSet.add(o.username.toLowerCase());
          }
        }

        return { totalAmount, totalPlayers: playersSet.size };
      } catch (err) {
        console.warn("MongoDB getStats error:", err);
      }
    }

    const store = localStore.get();
    let totalAmount = 0;
    const playersSet = new Set<string>();
    for (const ev of store.funding_events) {
      totalAmount += Number(ev.amount) || 0;
      if (ev.username) playersSet.add(ev.username.toLowerCase());
    }
    for (const o of store.orders) {
      if (o.status === "completed") {
        if (!store.funding_events.some((e) => e.orderId === o.id)) {
          totalAmount += Number(o.amount) || 0;
          if (o.username) playersSet.add(o.username.toLowerCase());
        }
      }
    }
    return { totalAmount, totalPlayers: playersSet.size };
  });
}
