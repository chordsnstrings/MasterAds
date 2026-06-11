// loops worker — relay queue consumers (G3); fast/medium loops arrive in G8/G10.
import PgBoss from "pg-boss";
import { createPlatformAdapters, createRelays } from "@engine/adapters";
import { runFastLoopOnce } from "@engine/core";
import { closeDb, connectionString, createDb, createRepos, sslConfig } from "@engine/db";
import { startRelayWorker } from "./relay-worker.js";

function log(msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: "loops", msg, ...extra }));
}

const db = createDb();
const repos = createRepos(db);
const boss = new PgBoss({ connectionString: connectionString(), ssl: sslConfig() });
boss.on("error", (err) => log("pg-boss error", { error: String(err) }));

let running = true;
const shutdown = (signal: string): void => {
  log("shutting down", { signal });
  running = false;
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

await boss.start();
await startRelayWorker(boss, repos, createRelays());

const platformAdapters = createPlatformAdapters({ repos });
const FAST_LOOP_INTERVAL_MS = Number(process.env.FAST_LOOP_INTERVAL_MS ?? 300_000);
const FAST_LOOP_DRY_RUN = process.env.FAST_LOOP_DRY_RUN === "1";

log("loops worker ready", {
  relays: ["meta", "google", "tiktok"],
  fastLoopIntervalMs: FAST_LOOP_INTERVAL_MS,
  dryRun: FAST_LOOP_DRY_RUN,
});

// Heartbeat + fast loop on a minutes cadence. The fast loop itself checks the
// kill switch at the top of every iteration (invariant 2).
let lastKillState = false;
let lastFastLoop = 0;
while (running) {
  const engaged = await repos.killSwitch.isEngaged();
  if (engaged !== lastKillState) {
    log(engaged ? "kill switch ENGAGED — writes halted" : "kill switch disengaged", {});
    lastKillState = engaged;
  }
  if (Date.now() - lastFastLoop >= FAST_LOOP_INTERVAL_MS) {
    lastFastLoop = Date.now();
    try {
      const report = await runFastLoopOnce(
        { repos, adapters: platformAdapters },
        { dryRun: FAST_LOOP_DRY_RUN },
      );
      log("fast loop ran", { ...report });
    } catch (err) {
      log("fast loop failed", { error: String(err) });
    }
  }
  await new Promise((r) => setTimeout(r, 1000));
}

await boss.stop();
await closeDb(db);
log("loops worker stopped");
process.exit(0);
