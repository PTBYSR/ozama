import { MongoClient, Db } from "mongodb";
import fs from "fs";
import path from "path";
import { OrderDoc, FundingLogDoc } from "./types";

const uri = process.env.MONGODB_URI || "";
const dbName = process.env.MONGODB_DB || "ozama";

let client: MongoClient | null = null;
let clientPromise: Promise<MongoClient> | null = null;

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

if (uri) {
  if (process.env.NODE_ENV === "development") {
    if (!global._mongoClientPromise) {
      client = new MongoClient(uri);
      global._mongoClientPromise = client.connect();
    }
    clientPromise = global._mongoClientPromise;
  } else {
    client = new MongoClient(uri);
    clientPromise = client.connect();
  }
}

export async function getDb(): Promise<Db | null> {
  if (!clientPromise) return null;
  try {
    const connectedClient = await clientPromise;
    return connectedClient.db(dbName);
  } catch (error) {
    console.warn("MongoDB connection failed, falling back to local store:", error);
    return null;
  }
}

// -------------------------------------------------------------
// Fallback Local File Store (if MONGODB_URI is not set yet)
// On Vercel, filesystem is read-only except /tmp
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
}

let inMemoryStore: LocalStore = { orders: [], funding_events: [] };

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

// -------------------------------------------------------------
// Universal dbAdapter (handles MongoDB and local fallback)
// -------------------------------------------------------------
export const dbAdapter = {
  async getOrder(orderId: string): Promise<OrderDoc | null> {
    const db = await getDb();
    if (db) {
      try {
        const doc = await db.collection("orders").findOne({ id: orderId });
        if (doc) return doc as unknown as OrderDoc;
      } catch (err) {
        console.warn("MongoDB getOrder error:", err);
      }
    }
    const store = localStore.get();
    return store.orders.find((o) => o.id === orderId) || null;
  },

  async updateOrder(orderId: string, update: Partial<OrderDoc>): Promise<void> {
    const db = await getDb();
    if (db) {
      try {
        await db.collection("orders").updateOne(
          { id: orderId },
          { $set: { ...update, updatedAt: new Date().toISOString() } }
        );
        return;
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
        updatedAt: new Date().toISOString(),
      };
      localStore.save(store);
    }
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
        return;
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
  },

  async createOrder(order: OrderDoc): Promise<OrderDoc> {
    const db = await getDb();
    if (db) {
      try {
        await db.collection("orders").insertOne({ ...order });
        return order;
      } catch (err) {
        console.warn("MongoDB createOrder error:", err);
      }
    }
    const store = localStore.get();
    store.orders.unshift(order);
    localStore.save(store);
    return order;
  },

  async getRecentOrders(limit = 6): Promise<OrderDoc[]> {
    const db = await getDb();
    if (db) {
      try {
        const docs = await db
          .collection("orders")
          .find({ status: { $in: ["completed", "streaming", "allocating"] } })
          .sort({ createdAt: -1 })
          .limit(limit)
          .toArray();
        return docs as unknown as OrderDoc[];
      } catch (err) {
        console.warn("MongoDB getRecentOrders error:", err);
      }
    }
    const store = localStore.get();
    return store.orders.slice(0, limit);
  },

  getStats: getGlobalStats,
};

export async function getGlobalStats(): Promise<{ totalAmount: number; totalPlayers: number }> {
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
  // Also include completed orders if not yet in funding_events
  for (const o of store.orders) {
    if (o.status === "completed") {
      if (!store.funding_events.some((e) => e.orderId === o.id)) {
        totalAmount += Number(o.amount) || 0;
        if (o.username) playersSet.add(o.username.toLowerCase());
      }
    }
  }
  return { totalAmount, totalPlayers: playersSet.size };
}
