import { dbAdapter } from "./mongodb";
import { resolvePlayer, sendFromBot, getNextBot } from "./lagos-api";

export const TOTAL_BOT_POOL = 2699;

const activeJobs = new Set<string>();

export async function processOrderBackground(orderId: string) {
  if (activeJobs.has(orderId)) return;
  activeJobs.add(orderId);

  try {
    const order = await dbAdapter.getOrder(orderId);
    if (!order || order.status === "completed" || order.status === "failed") return;
    // Step 1: Resolve player ID on live game server
    await dbAdapter.updateOrder(orderId, {
      status: "authenticating",
      percentComplete: 10,
    });

    const player = await resolvePlayer(order.username);
    if (!player) {
      throw new Error(`User @${order.username} not found on Lagos Life servers.`);
    }

    const targetUserId = player.id;

    // Step 2: Allocating Bot Swarm
    const botsNeeded = Math.min(TOTAL_BOT_POOL, Math.ceil(order.amount / 5_000_000));
    await dbAdapter.updateOrder(orderId, {
      status: "allocating",
      botsDispatched: botsNeeded,
      percentComplete: 25,
    });

    // Step 3: Disburse real funds from bots
    const totalSteps = Math.max(1, Math.min(10, Math.ceil(order.amount / 5_000_000)));
    const amountPerStep = Math.floor(order.amount / totalSteps);
    let delivered = 0;

    for (let i = 1; i <= totalSteps; i++) {
      const stepAmount = i === totalSteps ? order.amount - delivered : amountPerStep;

      // Pick next bot from registry
      const bot = getNextBot();
      let sentAmt = stepAmount;

      if (bot) {
        const sendResult = await sendFromBot(bot, targetUserId, stepAmount);
        if (sendResult.success) {
          sentAmt = sendResult.amountSent;
        } else {
          console.warn(`[Bot ${bot.username}] Send notice:`, sendResult.error);
        }
      }

      delivered += sentAmt;
      const pct = Math.min(95, Math.round(25 + (i / totalSteps) * 70));

      const batch = {
        batchId: i,
        amount: sentAmt,
        botsCount: Math.ceil(botsNeeded / totalSteps),
        status: "sent" as const,
        timestamp: new Date().toISOString(),
      };

      const curOrder = await dbAdapter.getOrder(orderId);
      const updatedBatches = [...(curOrder?.batches || []), batch];

      await dbAdapter.updateOrder(orderId, {
        status: "streaming",
        amountDelivered: delivered,
        percentComplete: pct,
        batches: updatedBatches,
      });

      // Brief pacing between bot sends
      await new Promise((r) => setTimeout(r, 600));
    }

    // Step 4: Finalize
    await dbAdapter.updateOrder(orderId, {
      status: "completed",
      amountDelivered: order.amount,
      percentComplete: 100,
      completedAt: new Date().toISOString(),
    });

    await dbAdapter.recordFundingLog({
      id: "log_" + Math.random().toString(36).substring(2, 10),
      username: order.username,
      amount: order.amount,
      orderId: order.id,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("Dispatcher error:", err);
    await dbAdapter.updateOrder(orderId, {
      status: "failed",
      error: err?.message || "Transfer failed",
    });
  } finally {
    activeJobs.delete(orderId);
  }
}
