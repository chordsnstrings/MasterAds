// Creative generation endpoints (G6) — used by Review's previews and
// "Make new ones" (FLOW §5.7).
import type { FastifyInstance } from "fastify";
import { generateCreatives } from "@engine/core";

export async function creativesRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>("/v1/specs/:id/creatives", async (req, reply) => {
    const spec = await app.repos.specs.get(req.params.id);
    if (!spec) return reply.status(404).send({ error: "not_found" });
    const product = await app.repos.products.get(spec.productId);
    if (!product) return reply.status(404).send({ error: "product_not_found" });

    const result = await generateCreatives(
      { repos: app.repos, llm: app.llm, provider: app.creative },
      product,
      spec,
    );
    if (result.kind === "cap_exceeded") {
      return reply.status(429).send({ error: "cap_exceeded", message: result.message });
    }
    if (result.kind === "all_blocked") {
      return reply.status(422).send({
        error: "all_blocked",
        blocked: result.blocked.map((b) => ({
          headline: b.headline,
          reasons: b.violations.map((v) => v.reason),
        })),
      });
    }
    return reply.status(201).send({
      creatives: result.creatives.map((c) => ({
        id: c.id,
        variantNo: c.variantNo,
        format: c.format,
        assetRef: c.assetRef,
        headline: c.payload.headline,
        body: c.payload.body,
        status: c.status,
      })),
      blocked: result.blocked.map((b) => ({
        headline: b.headline,
        reasons: b.violations.map((v) => v.reason),
      })),
    });
  });

  // Light edit (FLOW §5.7): change the words; never a per-format spec editor.
  app.patch<{ Params: { id: string }; Body: { headline?: string; body?: string } }>(
    "/v1/creatives/:id",
    async (req, reply) => {
      const creative = await app.repos.creatives.get(req.params.id);
      if (!creative) return reply.status(404).send({ error: "not_found" });
      const body = (req.body ?? {}) as { headline?: string; body?: string };
      await app.repos.creatives.updatePayload(creative.id, {
        ...(body.headline ? { headline: body.headline } : {}),
        ...(body.body ? { body: body.body } : {}),
      });
      return { ok: true };
    },
  );

  app.get<{ Params: { id: string } }>("/v1/products/:id/creatives", async (req) => {
    const creatives = await app.repos.creatives.byProduct(req.params.id);
    return { creatives };
  });
}
