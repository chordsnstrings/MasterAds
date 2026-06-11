// scheduler worker — cron-style triggers (SW §13.2): feed syncs now (G4);
// insights pulls, billing health, medium loop added in G7/G9/G10.
import { closeDb, createDb, createRepos } from "@engine/db";
import { createBillingChecker, createEmailSender, createLlmClient, createPlatformAdapters } from "@engine/adapters";
import { runFeedSyncSweep } from "./jobs/feed-sync.js";
import { runInsightsPull } from "./jobs/insights.js";
import { applyCalendarPacing, applyStoredConnections, getAiManagerSettings, runAiManagerOnce, computeAndPersistCoverage, computeAndPersistSignalQuality, dispatchNotifications, expirePromos, processProductChanges, queueAttentionNotifications, queueWeeklyDigest, reevaluateOptimizationEvents, runBillingHealth, runFatigueSweep, runMediumLoopOnce, scoreDecisions, updatePlaybookPriors } from "@engine/core";

function log(msg: string, extra: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({ ts: new Date().toISOString(), service: "scheduler", msg, ...extra }),
  );
}

const db = createDb();
const repos = createRepos(db);
await applyStoredConnections(repos);
const platformAdapters = createPlatformAdapters({ repos });
const emailSender = createEmailSender();
const llm = createLlmClient({ repos });

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
    name: "measurement-snapshots",
    intervalMs: 6 * 60 * 60_000, // coverage + signal strength for the UI
    lastRun: 0,
    run: async () => {
      await computeAndPersistCoverage(repos);
      await computeAndPersistSignalQuality(repos);
    },
  },
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
    name: "medium-loop",
    intervalMs: 24 * 60 * 60_000, // daily reasoning-brain cadence (SW §9.3)
    lastRun: 0,
    run: async () => {
      const r = await runMediumLoopOnce({ repos, adapters: platformAdapters });
      log("medium loop ran", { ...r });
    },
  },
  {
    name: "fatigue-sweep",
    intervalMs: 24 * 60 * 60_000,
    lastRun: 0,
    run: async () => {
      const r = await runFatigueSweep(repos);
      if (r.rotated.length > 0) log("creatives rotated", { ...r });
    },
  },
  {
    name: "event-reevaluation",
    intervalMs: 24 * 60 * 60_000,
    lastRun: 0,
    run: async () => {
      const r = await reevaluateOptimizationEvents({ repos, adapters: platformAdapters });
      if (r.deepened.length > 0) log("optimization events deepened", { ...r });
    },
  },
  {
    name: "playbook-priors",
    intervalMs: 24 * 60 * 60_000, // daily: creative learnings accrue per vertical
    lastRun: 0,
    run: async () => {
      const r = await updatePlaybookPriors(repos);
      if (r.updated.length > 0) log("playbook priors updated", { ...r });
    },
  },
  {
    name: "outcome-scoring",
    intervalMs: 6 * 60 * 60_000,
    lastRun: 0,
    run: async () => {
      const r = await scoreDecisions(repos);
      if (r.scored > 0) log("decisions scored", { ...r });
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
    name: "ai-manager",
    intervalMs: 24 * 60 * 60_000, // daily account review; off until enabled
    lastRun: 0,
    run: async () => {
      const settings = await getAiManagerSettings(repos);
      if (!settings.enabled) return;
      const r = await runAiManagerOnce(
        { repos, llm, adapters: platformAdapters },
        { dryRun: !settings.auto },
      );
      log("ai manager ran", { ...r, notes: r.notes.length });
    },
  },
  {
    name: "notifications",
    intervalMs: 5 * 60_000, // alert emails for items needing a person
    lastRun: 0,
    run: async () => {
      await queueAttentionNotifications(repos);
      const r = await dispatchNotifications(repos, emailSender);
      if (r.sent > 0 || r.failed > 0) log("notifications dispatched", { ...r });
    },
  },
  {
    name: "weekly-digest",
    intervalMs: 24 * 60 * 60_000, // checked daily; outbox dedupes per ISO week
    lastRun: 0,
    run: async () => {
      const r = await queueWeeklyDigest(repos);
      if (r.queued) log("weekly digest queued", {});
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
