// Plan building (FLOW §5): classify → playbook → spec, with the conditional
// product-vs-service disambiguation (FLOW §4.5).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildSpecForProduct, checkLaunchGate, classifyProduct } from "@engine/core";

const planBody = z.object({
  goal: z
    .enum(["best", "more_sales", "more_enquiries", "more_bookings", "more_app_installs", "more_website_visits"])
    .optional(),
  daily_budget: z.number().positive().optional(),
  budget_currency: z.string().length(3).optional(),
  disambiguation: z.enum(["product", "service"]).optional(),
  destination: z
    .object({
      kind: z.enum(["url", "hosted_page", "hosted_form", "whatsapp", "call"]),
      value: z.string(),
    })
    .optional(),
});

export async function planRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>("/v1/products/:id/plan", async (req, reply) => {
    const parsed = planBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: "invalid_body" });
    const product = await app.repos.products.get(req.params.id);
    if (!product) return reply.status(404).send({ error: "not_found" });

    const result = await classifyProduct(app.llm, product, {
      disambiguation: parsed.data.disambiguation,
    });
    if (result.kind === "needs_disambiguation") {
      return reply.status(200).send({ needsDisambiguation: true, question: result.question });
    }

    const spec = await buildSpecForProduct(app.repos, product, result.classification, {
      goal: parsed.data.goal,
      dailyBudget: parsed.data.daily_budget,
      budgetCurrency: parsed.data.budget_currency,
      destination: parsed.data.destination,
    });
    await app.repos.products.update(product.id, {
      vertical: result.classification.vertical,
      status: spec.policyCategory === "restricted" ? "in_review" : product.status,
    });
    const gate = await checkLaunchGate(app.repos, spec);

    return reply.status(201).send({
      specId: spec.id,
      goal: spec.goal,
      platforms: spec.targetPlatforms,
      perDay: Number(spec.dailyBudget),
      currency: spec.budgetCurrency,
      destination: spec.destination,
      policyCategory: spec.policyCategory,
      needsDestinationChoice: spec.destination === null,
      launchAllowed: gate.allowed,
      launchBlockedReason: gate.allowed ? null : gate.reason,
    });
  });

  // Restricted sign-off queue (one-time per playbook; SW §9.4 rule 4).
  app.get("/internal/playbooks/pending-signoff", async () => {
    const all = await app.repos.playbooks.list();
    return { pending: all.filter((p) => p.requiresSignoff && !p.signedOffAt) };
  });

  app.post<{ Params: { id: string }; Body: { by?: string } }>(
    "/internal/playbooks/:id/signoff",
    async (req, reply) => {
      const playbook = await app.repos.playbooks.get(req.params.id);
      if (!playbook) return reply.status(404).send({ error: "not_found" });
      const signed = await app.repos.playbooks.signOff(
        req.params.id,
        (req.body as { by?: string } | null)?.by ?? "operator",
      );
      return { id: signed.id, signedOffAt: signed.signedOffAt };
    },
  );
}
