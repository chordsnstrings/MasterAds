// Brands (W11): workspaces with their own look and their own ad accounts.
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const brandBody = z.object({
  name: z.string().min(1).max(80),
  logoUrl: z.string().optional(),
  primaryColor: z.string().optional(),
  tone: z.string().optional(),
});

export async function brandsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/internal/brands", async () => {
    const all = await app.repos.brands.list();
    const connections = await app.repos.platformConnections.list();
    const products = await app.repos.products.list();
    return {
      brands: all.map((b) => ({
        id: b.id,
        name: b.name,
        logoUrl: b.logoUrl,
        primaryColor: b.primaryColor,
        tone: b.tone,
        campaignCount: products.filter((p) => p.brandId === b.id).length,
        connectedPlatforms: connections
          .filter((c) => c.brandId === b.id && c.platform !== "ai")
          .map((c) => ({ platform: c.platform, adAccountRef: c.adAccountRef })),
      })),
    };
  });

  app.post("/internal/brands", async (req, reply) => {
    const parsed = brandBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_body" });
    const brand = await app.repos.brands.create(parsed.data);
    return reply.status(201).send({ id: brand.id, name: brand.name });
  });

  app.patch<{ Params: { id: string } }>("/internal/brands/:id", async (req, reply) => {
    const parsed = brandBody.partial().safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_body" });
    const brand = await app.repos.brands.get(req.params.id);
    if (!brand) return reply.status(404).send({ error: "not_found" });
    const updated = await app.repos.brands.update(req.params.id, parsed.data);
    return { id: updated.id, name: updated.name };
  });
}
