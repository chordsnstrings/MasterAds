import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import { closeDb, createDb, createRepos, type Db, type Repos } from "@engine/db";
import { createCreativeProvider, createLlmClient, createPlatformAdapters, type CreativeProvider, type LlmClient, type PlatformAdapter } from "@engine/adapters";
import { applyStoredConnections, seedPlaybooks, type Platform } from "@engine/core";
import type { JobSender } from "@engine/core";
import { eventsRoutes } from "./routes/events.js";
import { internalRoutes } from "./routes/internal.js";
import { intakeRoutes } from "./routes/intake.js";
import { planRoutes } from "./routes/plan.js";
import { creativesRoutes } from "./routes/creatives.js";
import { launchRoutes } from "./routes/launch.js";
import { uiRoutes } from "./routes/ui.js";
import { hostedRoutes } from "./routes/hosted.js";
import { monitoringRoutes } from "./routes/monitoring.js";
import { pixelRoutes } from "./routes/pixel.js";
import { leadsRoutes } from "./routes/leads.js";
import { connectionsRoutes } from "./routes/connections.js";
import { mediaRoutes } from "./routes/media.js";
import { rulesRoutes } from "./routes/rules.js";
import { aiManagerRoutes } from "./routes/aiManager.js";
import { brandsRoutes } from "./routes/brands.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    repos: Repos;
    jobs: JobSender | null;
    llm: LlmClient;
    creative: CreativeProvider;
    platforms: Record<Platform, PlatformAdapter>;
  }
}

export interface BuildAppOptions {
  db?: Db;
  llm?: LlmClient;
  creative?: CreativeProvider;
  platforms?: Record<Platform, PlatformAdapter>;
  /** Queue producer for relay fan-out; null disables enqueue (unit tests). */
  jobs?: JobSender | null;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    // 25MB video uploads arrive as base64 JSON (~33MB) — Fastify's default
    // 1MiB limit silently broke even the documented 3MB image uploads.
    bodyLimit: 40 * 1024 * 1024,
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
  // Credentials saved through the UI feed the same env-var seam as App
  // Platform secrets (explicit env always wins).
  await applyStoredConnections(repos);
  app.decorate("llm", opts.llm ?? createLlmClient({ repos }));
  app.decorate("creative", opts.creative ?? createCreativeProvider({ repos }));
  app.decorate("platforms", opts.platforms ?? createPlatformAdapters({ repos }));
  await seedPlaybooks(repos);

  // Operator auth (W1): when OPERATOR_TOKEN is set, every /internal/* request
  // must carry it in x-operator-key. Unset = open (dev/stub environments).
  app.addHook("onRequest", async (req, reply) => {
    const token = process.env.OPERATOR_TOKEN;
    if (!token) return;
    if (!req.url.startsWith("/internal")) return;
    if (req.headers["x-operator-key"] !== token) {
      return reply.status(401).send({ error: "operator_key_required" });
    }
  });

  app.get("/health", async () => ({ status: "ok", service: "api" }));

  // The supervision UI is the static site mounted at /app; the bare domain
  // belongs to the API's ingress rule, so send visitors to the UI.
  app.get("/", async (_req, reply) => reply.redirect("/app"));

  await app.register(eventsRoutes);
  await app.register(internalRoutes);
  await app.register(intakeRoutes);
  await app.register(planRoutes);
  await app.register(creativesRoutes);
  await app.register(launchRoutes);
  await app.register(uiRoutes);
  await app.register(hostedRoutes);
  await app.register(monitoringRoutes);
  await app.register(pixelRoutes);
  await app.register(leadsRoutes);
  await app.register(connectionsRoutes);
  await app.register(mediaRoutes);
  await app.register(rulesRoutes);
  await app.register(aiManagerRoutes);
  await app.register(brandsRoutes);

  return app;
}
