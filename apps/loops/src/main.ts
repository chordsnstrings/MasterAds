// loops worker — fast/medium loop runners, queue consumers, conversion relay.
// Real loop wiring lands in G3 (relay) and G8 (autonomy machinery).

let running = true;

function log(msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: "loops", msg, ...extra }));
}

const shutdown = (signal: string): void => {
  log("shutting down", { signal });
  running = false;
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

log("loops worker ready");

// Idle heartbeat until loops are wired in later chunks.
while (running) {
  await new Promise((r) => setTimeout(r, 1000));
}

log("loops worker stopped");
process.exit(0);
