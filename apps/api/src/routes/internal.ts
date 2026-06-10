// Internal endpoints consumed by the supervision UI and operators.
import type { FastifyInstance } from "fastify";
import { computeAndPersistCoverage } from "@engine/core";

export async function internalRoutes(app: FastifyInstance): Promise<void> {
  // Click-ID coverage (SW §8.7): compute over the rolling window, persist, return.
  app.get<{ Querystring: { days?: string } }>("/internal/coverage", async (req) => {
    const days = Number(req.query.days ?? 7);
    const rows = await computeAndPersistCoverage(app.repos, Number.isFinite(days) ? days : 7);
    return { windowDays: days, coverage: rows };
  });

  app.get("/internal/coverage/latest", async () => {
    return { coverage: await app.repos.coverage.latest() };
  });
}
