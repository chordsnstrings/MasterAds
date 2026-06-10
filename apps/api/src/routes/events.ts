// POST /v1/events — the inbound conversion contract (SW §7.1, invariant 8).
import type { FastifyInstance } from "fastify";
import { conversionPayloadSchema } from "@engine/contracts";
import { ingestConversion } from "@engine/core";

export async function eventsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/events", async (req, reply) => {
    const parsed = conversionPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_payload",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    const payload = parsed.data;

    // Per-site API key auth; keys are stored hashed.
    const apiKey = req.headers["x-api-key"];
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      return reply.status(401).send({ error: "missing_api_key" });
    }
    const valid = await app.repos.siteKeys.verify(payload.source_site, apiKey);
    if (!valid) {
      return reply.status(403).send({ error: "invalid_api_key_for_source_site" });
    }

    const result = await ingestConversion(app.repos, payload);
    // Replays of the same (source_site, event_id) return 200 without duplicating.
    return reply.status(result.duplicate ? 200 : 201).send({
      status: "accepted",
      id: result.event.id,
      duplicate: result.duplicate,
      canonical: result.canonical,
    });
  });
}
