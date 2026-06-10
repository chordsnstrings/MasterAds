// Launch endpoint (FLOW §9): commits the plan; restricted specs go to
// Submit-for-review instead (FLOW §8.6).
import type { FastifyInstance } from "fastify";
import { launchProduct } from "@engine/core";

export async function launchRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>("/v1/specs/:id/launch", async (req, reply) => {
    const spec = await app.repos.specs.get(req.params.id);
    if (!spec) return reply.status(404).send({ error: "not_found" });

    const result = await launchProduct(
      { repos: app.repos, adapters: app.platforms },
      spec.id,
    );

    if (result.kind === "blocked_restricted") {
      // Submit for review: calm confirmation, product enters In review.
      await app.repos.products.update(spec.productId, { status: "in_review" });
      await app.repos.attention.raise({
        kind: "restricted_approval",
        severity: "approval",
        message: "An offer needs a compliance check before it can go live.",
        fixHint: "Review and sign off the playbook in Settings → Autonomy.",
        targetRef: `spec:${spec.id}`,
      });
      return reply.status(202).send({ status: "in_review", message: result.message });
    }
    if (result.kind === "no_creatives") {
      return reply.status(409).send({ error: "no_creatives", message: "Generate ads before launching." });
    }
    if (result.kind === "no_destination") {
      return reply
        .status(409)
        .send({ error: "no_destination", message: "Choose where people go before launching." });
    }
    return reply.status(201).send({
      status: "live",
      campaigns: result.campaigns.map((c) => ({
        id: c.id,
        platform: c.platform,
        status: c.status,
      })),
      blockedPlatforms: result.blockedPlatforms,
      dailyCap: Number(spec.dailyBudget),
      currency: spec.budgetCurrency,
    });
  });
}
