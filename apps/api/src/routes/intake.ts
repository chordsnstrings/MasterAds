// Product intake endpoints (FLOW §4): one input, three ways in, async
// "reading…" status the UI polls.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { detectInputKind, intakeFromFeed, persistIntakeResult, runIntakeJob } from "@engine/core";

const intakeBody = z.object({ input: z.string().min(1) });
const fileBody = z.object({
  filename: z.string().min(1),
  content_base64: z.string().min(1),
});

export async function intakeRoutes(app: FastifyInstance): Promise<void> {
  // Paste a link or type a description — kind auto-detected (FLOW §4.2).
  app.post("/v1/intake", async (req, reply) => {
    const parsed = intakeBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_body" });
    const kind = detectInputKind(parsed.data.input);
    const job = await app.repos.intakeJobs.create(kind, parsed.data.input);
    // Process out of band; the UI polls GET /v1/intake/:id.
    setImmediate(() => {
      runIntakeJob(app.repos, job.id).catch((err) =>
        app.log.error({ err, jobId: job.id }, "intake job failed"),
      );
    });
    return reply.status(202).send({ intakeId: job.id, status: "reading" });
  });

  // Add a list: spreadsheet / product file (FLOW §3).
  app.post("/v1/intake/file", async (req, reply) => {
    const parsed = fileBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_body" });
    const job = await app.repos.intakeJobs.create("file", parsed.data.filename);
    const content = Buffer.from(parsed.data.content_base64, "base64");
    const result = intakeFromFeed(content, parsed.data.filename);
    const persisted = await persistIntakeResult(app.repos, result);
    await app.repos.intakeJobs.complete(
      job.id,
      result.kind === "unreadable" ? "unreadable" : "done",
      {
        kind: result.kind,
        suggestion: result.kind === "unreadable" ? result.suggestion : undefined,
        productIds: persisted.productIds,
        catalogGroupId: persisted.catalogGroupId,
        productCount: persisted.productIds.length,
      },
    );
    return reply.status(202).send({ intakeId: job.id, status: "reading" });
  });

  app.get<{ Params: { id: string } }>("/v1/intake/:id", async (req, reply) => {
    const job = await app.repos.intakeJobs.get(req.params.id);
    if (!job) return reply.status(404).send({ error: "not_found" });
    return { intakeId: job.id, status: job.status, result: job.result ?? null };
  });
}
