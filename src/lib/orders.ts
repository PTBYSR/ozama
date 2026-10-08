import { dbAdapter } from "./mongodb";
import { OrderDoc } from "./types";
import { processOrderBackground, TOTAL_BOT_POOL } from "./bot-dispatcher";

export function generateOrderId(): string {
  return "ozm_" + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
}

export function maskUsername(username: string): string {
  if (username.length <= 3) return username + "***";
  return username.slice(0, 3) + "***" + username.slice(-1);
}

export async function createOrder(username: string, amount: number, clientIp?: string): Promise<OrderDoc> {
  const id = generateOrderId();
  const now = new Date().toISOString();
  const botsNeeded = Math.min(TOTAL_BOT_POOL, Math.ceil(amount / 5_000_000));

  const order: OrderDoc = {
    id,
    username,
    amount,
    status: "queued",
    amountDelivered: 0,
    percentComplete: 0,
    botsDispatched: botsNeeded,
    batches: [],
    createdAt: now,
    updatedAt: now,
    clientIp,
  };

  await dbAdapter.createOrder(order);

  // Trigger background fulfillment dispatcher
  setTimeout(() => {
    processOrderBackground(id).catch(console.error);
  }, 100);

  return order;
}

export async function getOrder(id: string): Promise<OrderDoc | null> {
  return await dbAdapter.getOrder(id);
}

export async function getRecentOrders(limit = 6) {
  const orders = await dbAdapter.getRecentOrders(limit);
  return orders.map((o) => ({
    id: o.id,
    maskedUsername: maskUsername(o.username),
    amount: o.amount,
    completedAt: o.completedAt || o.createdAt,
    status: o.status,
  }));
}
