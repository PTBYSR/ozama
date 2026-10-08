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

      const botsNeeded = Math.min(TOTAL_BOT_POOL, Math.max(1, Math.ceil(order.amount / 500_000)));
      await dbAdapter.updateOrder(orderId, {
        status: "allocating",
        botsDispatched: botsNeeded,
        percentComplete: 30,
      });
      return await dbAdapter.getOrder(orderId);
    }

    // Step 3: allocating or streaming -> send batches until full chosen amount is delivered
    if (order.status === "allocating" || order.status === "streaming") {
      const delivered = order.amountDelivered || 0;
      const remainingAmount = order.amount - delivered;

      if (remainingAmount <= 0) {
        // Full chosen amount successfully reached! Finalize order.
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

      // Send up to ₦500k safe delta per bot batch, or the exact remaining amount if less
      const batchAmount = Math.min(remainingAmount, 500_000);
      const batches = order.batches || [];
      const nextBatchId = batches.length + 1;

      // Resolve recipient player on Lagos Life
      const player = await resolvePlayer(order.username);
      if (!player) {
        throw new Error(`User @${order.username} could not be resolved on Lagos Life.`);
      }

      // Task 2: Bot Swarm Failover — Try up to 8 bot profiles from getNextBot()
      // Task 3: Strict Progress Accounting — Initialize sentAmt = 0, only update if success
      let sentAmt = 0;
      let sendSuccess = false;
      let lastError = "";

      for (let attempt = 0; attempt < 8; attempt++) {
        const bot = getNextBot();
        if (!bot) {
          lastError = "No bots available in swarm registry pool";
          break;
        }

        console.log(`[Swarm Dispatch] Batch #${nextBatchId}: Trying bot @${bot.username} (attempt ${attempt + 1}/8) for ₦${batchAmount.toLocaleString()}...`);

        try {
          const sendResult = await sendFromBot(bot, player.id, batchAmount);
          if (sendResult.success && sendResult.amountSent > 0) {
            sentAmt = sendResult.amountSent;
            sendSuccess = true;
            console.log(`[Swarm Dispatch] Batch #${nextBatchId} SUCCESS via bot @${bot.username} (+₦${sentAmt.toLocaleString()})`);
            break;
          } else {
            lastError = sendResult.error || "Bot transfer failed";
            console.warn(`[Swarm Dispatch] Bot @${bot.username} attempt ${attempt + 1}/8 failed: ${lastError}`);
          }
        } catch (botErr: any) {
          lastError = botErr?.message || "Bot exception";
          console.warn(`[Swarm Dispatch] Bot @${bot.username} error: ${lastError}`);
        }

        // Brief delay between bot attempts to prevent burst contention
        await new Promise((r) => setTimeout(r, 250));
      }

      // Strict Progress Accounting:
      // If all bot attempts failed, do NOT advance amountDelivered or mark complete.
      if (!sendSuccess || sentAmt <= 0) {
        const failedBatch = {
          batchId: nextBatchId,
          amount: 0,
          botsCount: Math.ceil((order.botsDispatched || 10) / Math.max(1, Math.ceil(order.amount / 5_000_000))),
          status: "failed" as const,
          timestamp: new Date().toISOString(),
        };

        await dbAdapter.updateOrder(orderId, {
          status: "failed",
          error: `Swarm transfer failed: ${lastError}`,
          batches: [...batches, failedBatch],
        });
        return await dbAdapter.getOrder(orderId);
      }

      const newDelivered = delivered + sentAmt;
      // Calculate progress percentage up to 99% until fully completed
      const pct = Math.min(99, Math.max(30, Math.round((newDelivered / order.amount) * 100)));

      const newBatch = {
        batchId: nextBatchId,
        amount: sentAmt,
        botsCount: 1,
        status: "sent" as const,
        timestamp: new Date().toISOString(),
      };

      // Check if this batch finished the entire order
      if (newDelivered >= order.amount) {
        await dbAdapter.updateOrder(orderId, {
          status: "completed",
          amountDelivered: order.amount,
          percentComplete: 100,
          batches: [...batches, newBatch],
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
      } else {
        await dbAdapter.updateOrder(orderId, {
          status: "streaming",
          amountDelivered: newDelivered,
          percentComplete: pct,
          batches: [...batches, newBatch],
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

export async function resumeOrder(orderId: string) {
  const order = await dbAdapter.getOrder(orderId);
  if (!order || order.status === "completed") {
    return order;
  }
  await dbAdapter.updateOrder(orderId, {
    status: "streaming",
    error: undefined,
  });
  return await dbAdapter.getOrder(orderId);
}

