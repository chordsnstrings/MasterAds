// Internal endpoints consumed by the supervision UI and operators.
import type { FastifyInstance } from "fastify";
import { computeAndPersistCoverage, computeAndPersistSignalQuality } from "@engine/core";

export async function internalRoutes(app: FastifyInstance): Promise<void> {
  // Click-ID coverage (SW §8.7): compute over the rolling window, persist, return.
  app.get<{ Querystring: { days?: string } }>("/internal/coverage", async (req) => {
    const days = Number(req.query.days ?? 7);
    const rows = await computeAndPersistCoverage(app.repos, Number.isFinite(days) ? days : 7);
    const signal = await computeAndPersistSignalQuality(app.repos, Number.isFinite(days) ? days : 7);
    return { windowDays: days, coverage: rows, signal };
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

  // Site onboarding (W1.3): create returns the key ONCE; list never shows keys.
  app.get("/internal/sites", async () => ({ sites: await app.repos.siteKeys.list() }));

  app.post<{ Body: { site?: string; label?: string } }>("/internal/sites", async (req, reply) => {
    const body = (req.body ?? {}) as { site?: string; label?: string };
    const site = body.site?.trim().toLowerCase().replace(/[^a-z0-9-_.]/g, "-");
    if (!site) return reply.status(400).send({ error: "site name required" });
    const { randomBytes } = await import("node:crypto");
    const key = `sk_${randomBytes(24).toString("hex")}`;
    await app.repos.siteKeys.create(site, key, body.label);
    return reply.status(201).send({ site, key });
  });

  // Incrementality experiments (W3.5): geo holdouts — the causal calibration.
  app.get("/internal/experiments", async () => ({
    experiments: await app.repos.experiments.list(),
  }));

  app.post("/internal/experiments", async (req, reply) => {
    const body = (req.body ?? {}) as {
      name?: string;
      platform?: string;
      test_region?: string;
      control_region?: string;
      starts_at?: string;
      ends_at?: string;
    };
    if (!body.name || !body.test_region || !body.control_region || !body.starts_at || !body.ends_at) {
      return reply
        .status(400)
        .send({ error: "name, test_region, control_region, starts_at, ends_at required" });
    }
    const exp = await app.repos.experiments.create({
      name: body.name,
      platform: body.platform ?? null,
      testRegion: body.test_region,
      controlRegion: body.control_region,
      startsAt: new Date(body.starts_at),
      endsAt: new Date(body.ends_at),
      status: "running",
    });
    return reply.status(201).send(exp);
  });

  app.post<{ Params: { id: string } }>("/internal/experiments/:id/complete", async (req, reply) => {
    const body = (req.body ?? {}) as {
      test_conversions?: number;
      control_conversions?: number;
      incremental_return?: number;
    };
    if (typeof body.test_conversions !== "number" || typeof body.control_conversions !== "number") {
      return reply.status(400).send({ error: "test_conversions and control_conversions required" });
    }
    const lift =
      body.control_conversions > 0
        ? ((body.test_conversions - body.control_conversions) / body.control_conversions) * 100
        : body.test_conversions > 0
          ? 100
          : 0;
    const exp = await app.repos.experiments.complete(req.params.id, {
      test_conversions: body.test_conversions,
      control_conversions: body.control_conversions,
      lift_pct: Math.round(lift * 100) / 100,
      ...(body.incremental_return !== undefined
        ? { incremental_return: body.incremental_return }
        : {}),
    });
    return exp;
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
