// scheduler worker — cron-style triggers (SW §13.2): feed syncs now (G4);
// insights pulls, billing health, medium loop added in G7/G9/G10.
import { closeDb, createDb, createRepos } from "@engine/db";
import { runFeedSyncSweep } from "./jobs/feed-sync.js";

function log(msg: string, extra: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({ ts: new Date().toISOString(), service: "scheduler", msg, ...extra }),
  );
}

const db = createDb();
const repos = createRepos(db);

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
