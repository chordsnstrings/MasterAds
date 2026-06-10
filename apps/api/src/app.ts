import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { closeDb, createDb, createRepos, type Db, type Repos } from "@engine/db";
import type { JobSender } from "@engine/core";
import { eventsRoutes } from "./routes/events.js";
import { internalRoutes } from "./routes/internal.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    repos: Repos;
    jobs: JobSender | null;
  }
}

export interface BuildAppOptions {
  db?: Db;
  /** Queue producer for relay fan-out; null disables enqueue (unit tests). */
  jobs?: JobSender | null;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });
  await app.register(cors, { origin: true });

  const db = opts.db ?? createDb();
  app.decorate("db", db);
  app.decorate("repos", createRepos(db));
  if (!opts.db) {
    app.addHook("onClose", async () => closeDb(db));
  }
  app.decorate("jobs", opts.jobs ?? null);

  app.get("/health", async () => ({ status: "ok", service: "api" }));

  await app.register(eventsRoutes);
  await app.register(internalRoutes);

  return app;
}
