// scheduler worker — cron-style triggers: feed syncs, daily medium loop,
// report pulls, token refresh. Jobs are registered in G4, G7, G9, G10.

let running = true;

function log(msg: string, extra: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({ ts: new Date().toISOString(), service: "scheduler", msg, ...extra }),
  );
}

const shutdown = (signal: string): void => {
  log("shutting down", { signal });
  running = false;
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

log("scheduler worker ready");

while (running) {
  await new Promise((r) => setTimeout(r, 1000));
}

log("scheduler worker stopped");
process.exit(0);
