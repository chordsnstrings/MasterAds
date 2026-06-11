import PgBoss from "pg-boss";
import { connectionOptions } from "@engine/db";
import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);

// The API is the relay producer: ingested conversions are fanned out to the
// platform queues here and consumed by the loops worker.
const boss = new PgBoss(connectionOptions());
await boss.start();

const app = await buildApp({ jobs: boss });
boss.on("error", (err) => app.log.error({ err }, "pg-boss error"));

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await boss.stop({ wait: false });
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
