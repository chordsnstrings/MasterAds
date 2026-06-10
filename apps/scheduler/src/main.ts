// scheduler worker — cron-style triggers (SW §13.2): feed syncs now (G4);
// insights pulls, billing health, medium loop added in G7/G9/G10.
import { closeDb, createDb, createRepos } from "@engine/db";
import { createBillingChecker, createPlatformAdapters } from "@engine/adapters";
import { runFeedSyncSweep } from "./jobs/feed-sync.js";
import { runInsightsPull } from "./jobs/insights.js";
import { applyCalendarPacing, expirePromos, processProductChanges, runBillingHealth } from "@engine/core";

function log(msg: string, extra: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({ ts: new Date().toISOString(), service: "scheduler", msg, ...extra }),
  );
}

const db = createDb();
const repos = createRepos(db);
const platformAdapters = createPlatformAdapters({ repos });

let running = true;
const shutdown = (signal: string): void => {
  log("shutting down", { signal });
  running = false;
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

interface ScheduledJob {
  name: string;
  intervalMs: number;
  lastRun: number;
  run: () => Promise<void>;
}

const jobs: ScheduledJob[] = [
  {
    name: "insights-pull",
    intervalMs: 60 * 60_000, // hourly; rows are idempotent per (campaign, day)
    lastRun: 0,
    run: async () => {
      const r = await runInsightsPull(repos, platformAdapters);
      log("insights pulled", { ...r });
    },
  },
  {
    name: "product-change-sweep",
    intervalMs: 15 * 60_000, // within the feed sync window (stock-out → pause)
    lastRun: 0,
    run: async () => {
      const r = await processProductChanges({ repos, adapters: platformAdapters });
      if (r.processed > 0) log("product changes processed", { ...r });
    },
  },
  {
    name: "promo-expiry",
    intervalMs: 60 * 60_000,
    lastRun: 0,
    run: async () => {
      const r = await expirePromos(repos);
      if (r.expiredPromos > 0) log("promos expired", { ...r });
    },
  },
  {
    name: "billing-health",
    intervalMs: 6 * 60 * 60_000,
    lastRun: 0,
    run: async () => {
      const r = await runBillingHealth(repos, createBillingChecker());
      log("billing health checked", { ...r });
    },
  },
  {
    name: "calendar-pacing",
    intervalMs: 24 * 60 * 60_000,
    lastRun: 0,
    run: async () => {
      const r = await applyCalendarPacing({ repos, adapters: platformAdapters });
      if (r.adjusted.length > 0) log("calendar pacing applied", { ...r });
    },
  },
  {
    name: "feed-sync-sweep",
    intervalMs: 15 * 60_000, // sweep often; per-feed cadence enforced by `due`
    lastRun: 0,
    run: async () => {
      await runFeedSyncSweep(repos);
    },
  },
];

log("scheduler worker ready", { jobs: jobs.map((j) => j.name) });

while (running) {
  // Kill switch checked at the top of every iteration (invariant 2).
  const halted = await repos.killSwitch.isEngaged();
  if (!halted) {
    const now = Date.now();
    for (const job of jobs) {
      if (now - job.lastRun >= job.intervalMs) {
        job.lastRun = now;
        try {
          await job.run();
        } catch (err) {
          log("job failed", { job: job.name, error: String(err) });
        }
      }
    }
  }
  await new Promise((r) => setTimeout(r, 1000));
}

await closeDb(db);
log("scheduler worker stopped");
process.exit(0);
