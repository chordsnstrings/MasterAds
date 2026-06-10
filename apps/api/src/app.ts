import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ status: "ok", service: "api" }));

  return app;
}
