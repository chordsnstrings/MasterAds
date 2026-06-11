// AI manager (W10): settings + on-demand run. Default is propose-only;
// "act within limits" is an explicit opt-in. All under /internal (operator
// token applies); every action lands in the Decision log either way.
import type { FastifyInstance } from "fastify";
import { getAiManagerSettings, runAiManagerOnce } from "@engine/core";

export async function aiManagerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/internal/ai-manager", async () => getAiManagerSettings(app.repos));

  app.post("/internal/ai-manager", async (req, reply) => {
    const body = req.body as { enabled?: boolean; auto?: boolean } | null;
    if (!body || (typeof body.enabled !== "boolean" && typeof body.auto !== "boolean")) {
      return reply.status(400).send({ error: "invalid_body" });
    }
    const current = await getAiManagerSettings(app.repos);
    const next = {
      enabled: body.enabled ?? current.enabled,
      auto: body.auto ?? current.auto,
    };
    await app.repos.settings.set("ai_manager", next);
    return next;
  });

  app.post("/internal/ai-manager/run", async (req) => {
    const dryRun = (req.body as { dry_run?: boolean } | null)?.dry_run ?? true;
    return runAiManagerOnce(
      { repos: app.repos, llm: app.llm, adapters: app.platforms },
      { dryRun },
    );
  });
}
