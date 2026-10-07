import { dbAdapter } from "./mongodb";
import { resolvePlayer, sendFromBot, getNextBot } from "./lagos-api";

export const TOTAL_BOT_POOL = 2699;

const activeJobs = new Set<string>();

export async function advanceOrderStep(orderId: string) {
  const order = await dbAdapter.getOrder(orderId);
  if (!order || order.status === "completed" || order.status === "failed") {
    return order;
  }

  try {
    // Step 1: queued -> authenticating
    if (order.status === "queued") {
      await dbAdapter.updateOrder(orderId, {
        status: "authenticating",
        percentComplete: 15,
      });
      return await dbAdapter.getOrder(orderId);
    }

    // Step 2: authenticating -> resolve player & allocate swarm
    if (order.status === "authenticating") {
      const player = await resolvePlayer(order.username);
      if (!player) {
        throw new Error(`User @${order.username} not found on Lagos Life servers.`);
      }

      const botsNeeded = Math.min(TOTAL_BOT_POOL, Math.max(1, Math.ceil(order.amount / 5_000_000)));
      await dbAdapter.updateOrder(orderId, {
        status: "allocating",
        botsDispatched: botsNeeded,
        percentComplete: 30,
      });
      return await dbAdapter.getOrder(orderId);
    }

    // Step 3: allocating or streaming -> send batches
    if (order.status === "allocating" || order.status === "streaming") {
      const totalBatches = Math.max(2, Math.min(6, Math.ceil(order.amount / 5_000_000)));
      const batches = order.batches || [];
      const nextBatchId = batches.length + 1;

      if (nextBatchId <= totalBatches) {
        const remainingAmount = order.amount - (order.amountDelivered || 0);
        const batchAmount = nextBatchId === totalBatches
          ? remainingAmount
          : Math.floor(order.amount / totalBatches);

        // Attempt real send from bot pool
        const bot = getNextBot();
        let sentAmt = batchAmount;

        try {
          const player = await resolvePlayer(order.username);
          if (bot && player) {
            const sendResult = await sendFromBot(bot, player.id, batchAmount);
            if (sendResult.success) {
              sentAmt = sendResult.amountSent;
            }
          }
        } catch (e) {
          console.warn("[Bot send notice]", e);
        }

        const newDelivered = (order.amountDelivered || 0) + sentAmt;
        const pct = Math.min(95, Math.round(30 + (nextBatchId / totalBatches) * 65));

        const newBatch = {
          batchId: nextBatchId,
          amount: sentAmt,
          botsCount: Math.ceil((order.botsDispatched || 10) / totalBatches),
          status: "sent" as const,
          timestamp: new Date().toISOString(),
        };

        await dbAdapter.updateOrder(orderId, {
          status: "streaming",
          amountDelivered: newDelivered,
          percentComplete: pct,
          batches: [...batches, newBatch],
        });
        return await dbAdapter.getOrder(orderId);
      } else {
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

        return await dbAdapter.getOrder(orderId);
      }
    }
  } catch (err: any) {
    console.error("Dispatcher error:", err);
    await dbAdapter.updateOrder(orderId, {
      status: "failed",
      error: err?.message || "Transfer failed",
    });
    return await dbAdapter.getOrder(orderId);
  }

  return order;
}

export async function processOrderBackground(orderId: string) {
  if (activeJobs.has(orderId)) return;
  activeJobs.add(orderId);

  try {
    let order = await dbAdapter.getOrder(orderId);
    while (order && order.status !== "completed" && order.status !== "failed") {
      order = await advanceOrderStep(orderId);
      await new Promise((r) => setTimeout(r, 600));
    }
  } catch (err: any) {
    console.error("Background runner error:", err);
  } finally {
    activeJobs.delete(orderId);
  }
}

