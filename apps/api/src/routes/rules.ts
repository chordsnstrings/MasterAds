// User-defined automation rules (W9): CRUD for the "Your rules" section.
// Rules are settings-class rows; the Decisions their firings produce are the
// audit trail. All under /internal → operator-token hook applies.
import type { FastifyInstance } from "fastify";
import { ruleInputSchema } from "@engine/core";

export async function rulesRoutes(app: FastifyInstance): Promise<void> {
  app.get("/internal/rules", async () => {
    const rules = await app.repos.automationRules.list();
    return {
      rules: rules.map((r) => ({
        id: r.id,
        name: r.name,
        enabled: r.enabled,
        scope: r.scope,
        productId: r.productId,
        metric: r.metric,
        windowDays: r.windowDays,
        comparator: r.comparator,
        threshold: Number(r.threshold),
        action: r.action,
        cooldownHours: r.cooldownHours,
        lastFiredAt: r.lastFiredAt,
      })),
    };
  });

  app.post("/internal/rules", async (req, reply) => {
    const parsed = ruleInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_rule", detail: parsed.error.issues });
    }
    const r = parsed.data;
    const rule = await app.repos.automationRules.create({
      name: r.name,
      scope: r.scope,
      productId: r.product_id ?? null,
      metric: r.metric,
      windowDays: r.window_days,
      comparator: r.comparator,
      threshold: r.threshold.toFixed(4),
      action: r.action,
      cooldownHours: r.cooldown_hours,
    });
    return reply.status(201).send({ id: rule.id });
  });

  app.patch<{ Params: { id: string } }>("/internal/rules/:id", async (req, reply) => {
    const enabled = (req.body as { enabled?: boolean } | null)?.enabled;
    if (typeof enabled !== "boolean") return reply.status(400).send({ error: "invalid_body" });
    await app.repos.automationRules.setEnabled(req.params.id, enabled);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/internal/rules/:id", async (req) => {
    await app.repos.automationRules.delete(req.params.id);
    return { ok: true };
  });
}
