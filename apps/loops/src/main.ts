// loops worker — relay queue consumers (G3); fast/medium loops arrive in G8/G10.
import PgBoss from "pg-boss";
import { createRelays } from "@engine/adapters";
import { closeDb, connectionString, createDb, createRepos } from "@engine/db";
import { startRelayWorker } from "./relay-worker.js";

function log(msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: "loops", msg, ...extra }));
}

const db = createDb();
const repos = createRepos(db);
const boss = new PgBoss(connectionString());
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

log("loops worker ready", { relays: ["meta", "google", "tiktok"] });

// Heartbeat; kill-switch state is logged for operators (handlers check it too).
let lastKillState = false;
while (running) {
  const engaged = await repos.killSwitch.isEngaged();
  if (engaged !== lastKillState) {
    log(engaged ? "kill switch ENGAGED — writes halted" : "kill switch disengaged", {});
    lastKillState = engaged;
  }
  await new Promise((r) => setTimeout(r, 1000));
}

await boss.stop();
await closeDb(db);
log("loops worker stopped");
process.exit(0);
