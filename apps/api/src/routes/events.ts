// POST /v1/events — the inbound conversion contract (SW §7.1, invariant 8).
import type { FastifyInstance } from "fastify";
import { conversionPayloadSchema } from "@engine/contracts";
import { enqueueRelay, ingestConversion } from "@engine/core";

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

    // Auto-enrich match-quality signals from the transport when absent —
    // browser-posted events get ip/user_agent without site work.
    if (!payload.client_ip_address && req.ip) payload.client_ip_address = req.ip;
    if (!payload.client_user_agent && typeof req.headers["user-agent"] === "string") {
      payload.client_user_agent = req.headers["user-agent"].slice(0, 512);
    }
    const result = await ingestConversion(app.repos, payload);
    // Fan out to the platform relay queues — once per canonical conversion.
    if (app.jobs && !result.duplicate && result.canonical) {
      await enqueueRelay(app.jobs, result.event.id, String(req.id));
    }
    // Replays of the same (source_site, event_id) return 200 without duplicating.
    return reply.status(result.duplicate ? 200 : 201).send({
      status: "accepted",
      id: result.event.id,
      duplicate: result.duplicate,
      canonical: result.canonical,
    });
  });
}
