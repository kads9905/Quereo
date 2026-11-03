import { Monitor } from "../models/monitor.model.js";
import { runMonitor } from "./monitor.service.js";

const TICK_MS = 15_000;
// If a server dies mid-run, its lock expires and another server takes over
const LOCK_MS = 2 * 60 * 1000;
const MAX_PER_TICK = 50;
const CONCURRENCY = 5;

// Atomically "claims" one due monitor: in a single database operation it finds
// a monitor that is due and not locked, locks it, and moves nextRunAt forward.
// Because find + update happen together, two server instances can never
// claim the same monitor, so a check never runs twice.
const claimDueMonitor = (now = new Date()) =>
  Monitor.findOneAndUpdate(
    {
      enabled: true,
      nextRunAt: { $lte: now },
      $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }],
    },
    // Pipeline update so nextRunAt can use the document's own intervalSeconds
    [{
      $set: {
        lockedUntil: new Date(now.getTime() + LOCK_MS),
        nextRunAt: { $add: [now, { $multiply: ["$intervalSeconds", 1000] }] },
      },
    }],
    { sort: { nextRunAt: 1 }, returnDocument: "after", updatePipeline: true }
  );

// Runs every due monitor, at most CONCURRENCY at a time
const runDueMonitors = async (now = new Date()) => {
  const claimed = [];
  for (let i = 0; i < MAX_PER_TICK; i++) {
    const monitor = await claimDueMonitor(now);
    if (!monitor) break;
    claimed.push(monitor);
  }

  for (let i = 0; i < claimed.length; i += CONCURRENCY) {
    await Promise.all(
      claimed.slice(i, i + CONCURRENCY).map((monitor) =>
        runMonitor(monitor).catch(async (error) => {
          console.error(`Monitor ${monitor._id} crashed:`, error);
          await Monitor.updateOne({ _id: monitor._id }, { $set: { lockedUntil: null } });
        })
      )
    );
  }

  return claimed.length;
};

let timer = null;
let ticking = false;

const startScheduler = () => {
  if (timer) return;

  timer = setInterval(async () => {
    // Skip a tick if the previous one is still running
    if (ticking) return;
    ticking = true;
    try {
      await runDueMonitors();
    } catch (error) {
      console.error("Scheduler tick failed:", error);
    } finally {
      ticking = false;
    }
  }, TICK_MS);

  console.log(`Monitor scheduler started (every ${TICK_MS / 1000}s)`);
};

const stopScheduler = () => {
  clearInterval(timer);
  timer = null;
};

export { startScheduler, stopScheduler, runDueMonitors, claimDueMonitor };
