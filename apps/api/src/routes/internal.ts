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

  // Kill switch admin (invariant 2): works even when workers are wedged,
  // because workers read the flag from the DB every iteration.
  app.get("/internal/kill-switch", async () => ({
    engaged: await app.repos.killSwitch.isEngaged(),
  }));

  app.post<{ Body: { engaged: boolean } }>("/internal/kill-switch", async (req, reply) => {
    const body = req.body as { engaged?: unknown } | null;
    if (typeof body?.engaged !== "boolean") {
      return reply.status(400).send({ error: "engaged must be a boolean" });
    }
    await app.repos.killSwitch.set(body.engaged);
    app.log.warn({ engaged: body.engaged }, "kill switch changed");
    return { engaged: body.engaged };
  });

  // Guardrail settings (UI Settings → Guardrails, G11).
  app.get("/internal/guardrails", async () => {
    const { getGuardrailConfig } = await import("@engine/core");
    return getGuardrailConfig(app.repos);
  });

  app.patch("/internal/guardrails", async (req) => {
    const { setGuardrailConfig } = await import("@engine/core");
    return setGuardrailConfig(app.repos, (req.body ?? {}) as Record<string, number>);
  });

  // Attention records (UX §7).
  app.get("/internal/attention", async () => ({
    attention: await app.repos.attention.listOpen(),
  }));

  app.post<{ Params: { id: string } }>("/internal/attention/:id/resolve", async (req) => {
    await app.repos.attention.resolve(req.params.id);
    return { resolved: true };
  });
}
