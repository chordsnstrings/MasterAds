// Lead-quality / offline-conversion loop (W3.1 — formerly Phase Two, lifted).
// CRMs report what happened to a lead; closed leads become canonical
// Purchase-class conversions inheriting the original lead's click IDs and
// identifiers, relay to the platforms as offline conversions, and flow into
// net-return optimization — so lead-gen optimizes closed revenue, not form fills.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { enqueueRelay } from "@engine/core";

const outcomeBody = z.object({
  source_site: z.string().min(1),
  event_id: z.string().min(1),
  status: z.enum(["qualified", "closed", "disqualified"]),
  value: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
});

export async function leadsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/leads/outcome", async (req, reply) => {
    const parsed = outcomeBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_payload",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const body = parsed.data;

    const apiKey = req.headers["x-api-key"];
    if (typeof apiKey !== "string" || !(await app.repos.siteKeys.verify(body.source_site, apiKey))) {
      return reply.status(403).send({ error: "invalid_api_key_for_source_site" });
    }

    // Find the original lead by the same idempotency key the site used.
    const claims = await app.repos.conversions.listWindow(
      new Date(0),
      new Date(Date.now() + 60_000),
    );
    const lead = claims.find(
      (e) => e.sourceSite === body.source_site && e.eventId === body.event_id && e.canonical,
    );
    if (!lead) return reply.status(404).send({ error: "lead_not_found" });
    if (lead.eventName !== "Lead") {
      return reply.status(409).send({ error: "not_a_lead", eventName: lead.eventName });
    }

    if (body.status === "closed" && body.value === undefined) {
      return reply.status(400).send({ error: "value required when status is closed" });
    }

    // Audit every outcome in the Decision log.
    await app.repos.decisions.insert({
      loop: "system",
      worker: "lead-quality",
      actionType: "lead_outcome",
      targetRef: `event:${lead.id}`,
      rationale:
        body.status === "closed"
          ? `An enquiry turned into a sale worth ${body.value} ${body.currency ?? "AED"} — the engine now optimizes toward enquiries like this one.`
          : body.status === "qualified"
            ? "An enquiry was confirmed as a real prospect."
            : "An enquiry was marked not a fit; it won't count toward results quality.",
      evidence: [{ metric: "lead_status", window: "crm", result: body.status }],
      guardrailStatus: "passed",
      executed: true,
      productId: lead.contentId,
    });

    if (body.status !== "closed") {
      return reply.status(200).send({ status: body.status, recorded: true });
    }

    // Closed: write the offline conversion inheriting the lead's identity.
    const { event, duplicate } = await app.repos.conversions.insertIdempotent({
      eventName: "Purchase",
      eventTime: new Date(),
      value: body.value!.toFixed(4),
      currency: (body.currency ?? "AED").toUpperCase(),
      contentId: lead.contentId,
      clickIds: lead.clickIds,
      hashedIdentifiers: lead.hashedIdentifiers,
      clientInfo: lead.clientInfo,
      consentSignals: lead.consentSignals,
      eventId: `${body.event_id}-closed`,
      sourceSite: body.source_site,
      consentGranted: lead.consentGranted,
      dedupKey: `${body.source_site}:${body.event_id}-closed`,
      reconciliationKey: `Purchase:${body.event_id}-closed:${
        lead.hashedIdentifiers.email_sha256 ?? lead.hashedIdentifiers.phone_sha256 ?? "anon"
      }`,
      canonical: true,
    });
    if (app.jobs && !duplicate) {
      await enqueueRelay(app.jobs, event.id, String(req.id));
    }
    return reply.status(duplicate ? 200 : 201).send({
      status: "closed",
      conversionId: event.id,
      duplicate,
    });
  });
}
