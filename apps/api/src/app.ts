import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import { closeDb, createDb, createRepos, type Db, type Repos } from "@engine/db";
import { createCreativeProvider, createLlmClient, createPlatformAdapters, type CreativeProvider, type LlmClient, type PlatformAdapter } from "@engine/adapters";
import { seedPlaybooks } from "@engine/core";
import type { JobSender } from "@engine/core";
import { eventsRoutes } from "./routes/events.js";
import { internalRoutes } from "./routes/internal.js";
import { intakeRoutes } from "./routes/intake.js";
import { planRoutes } from "./routes/plan.js";
import { creativesRoutes } from "./routes/creatives.js";
import { launchRoutes } from "./routes/launch.js";
import { uiRoutes } from "./routes/ui.js";
import { hostedRoutes } from "./routes/hosted.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    repos: Repos;
    jobs: JobSender | null;
    llm: LlmClient;
    creative: CreativeProvider;
    platforms: Record<"meta" | "google" | "tiktok", PlatformAdapter>;
  }
}

export interface BuildAppOptions {
  db?: Db;
  llm?: LlmClient;
  creative?: CreativeProvider;
  platforms?: Record<"meta" | "google" | "tiktok", PlatformAdapter>;
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
  await app.register(formbody);

  const db = opts.db ?? createDb();
  app.decorate("db", db);
  app.decorate("repos", createRepos(db));
  if (!opts.db) {
    app.addHook("onClose", async () => closeDb(db));
  }
  app.decorate("jobs", opts.jobs ?? null);
  const repos = createRepos(db);
  app.decorate("llm", opts.llm ?? createLlmClient({ repos }));
  app.decorate("creative", opts.creative ?? createCreativeProvider({ repos }));
  app.decorate("platforms", opts.platforms ?? createPlatformAdapters({ repos }));
  await seedPlaybooks(repos);

  app.get("/health", async () => ({ status: "ok", service: "api" }));

  await app.register(eventsRoutes);
  await app.register(internalRoutes);
  await app.register(intakeRoutes);
  await app.register(planRoutes);
  await app.register(creativesRoutes);
  await app.register(launchRoutes);
  await app.register(uiRoutes);
  await app.register(hostedRoutes);

  return app;
}
