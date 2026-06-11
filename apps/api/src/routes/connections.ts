// Platform connections (W7): credentials entered through the UI, stored
// server-side, returned only masked. Saving also records WHICH ad account
// the channel runs under (visible in Settings) and exports the values for
// this process; workers pick them up on their next start.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CONNECTION_FIELDS,
  CONNECTION_PLATFORMS,
  accountRefField,
  maskCredential,
  missingRequired,
  type Platform,
} from "@engine/core";

const saveBody = z.object({
  credentials: z.record(z.string(), z.string()),
});

export async function connectionsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/internal/connections", async () => {
    const saved = await app.repos.platformConnections.list();
    return {
      platforms: CONNECTION_PLATFORMS.map((platform) => {
        const row = saved.find((r) => r.platform === platform);
        return {
          platform,
          adAccountRef: row?.adAccountRef ?? null,
          savedAt: row?.updatedAt ?? null,
          fields: CONNECTION_FIELDS[platform].map((f) => ({
            key: f.key,
            secret: f.secret,
            required: f.required,
            isAccountRef: f.isAccountRef ?? false,
            savedMask: row?.credentials[f.key] ? maskCredential(row.credentials[f.key]!) : null,
          })),
        };
      }),
    };
  });

  app.post<{ Params: { platform: string } }>(
    "/internal/connections/:platform",
    async (req, reply) => {
      const platform = req.params.platform as Platform;
      if (!CONNECTION_PLATFORMS.includes(platform)) {
        return reply.status(404).send({ error: "unknown_platform" });
      }
      const body = saveBody.safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: "invalid_body" });

      // Blank values mean "keep what's saved": merge onto the existing row.
      const existing = await app.repos.platformConnections.get(platform);
      const incoming = Object.fromEntries(
        Object.entries(body.data.credentials)
          .map(([k, v]) => [k, v.trim()])
          .filter(([k, v]) => v !== "" && CONNECTION_FIELDS[platform].some((f) => f.key === k)),
      ) as Record<string, string>;
      const merged = { ...(existing?.credentials ?? {}), ...incoming };

      const missing = missingRequired(platform, merged);
      if (missing.length > 0) {
        return reply.status(400).send({ error: "missing_fields", missing });
      }

      const refKey = accountRefField(platform)?.key;
      const adAccountRef = refKey ? merged[refKey] ?? null : null;
      const row = await app.repos.platformConnections.upsert(
        platform,
        merged,
        adAccountRef ?? undefined,
      );
      // Settings "Connected accounts" shows which exact account is linked.
      await app.repos.adAccounts.upsert(platform, { accountRef: adAccountRef });
      // This process can use the values immediately; workers on next start.
      for (const f of CONNECTION_FIELDS[platform]) {
        if (merged[f.key] && !process.env[f.envVar]) process.env[f.envVar] = merged[f.key];
      }
      return {
        platform,
        adAccountRef: row.adAccountRef,
        saved: Object.keys(merged),
      };
    },
  );
}
