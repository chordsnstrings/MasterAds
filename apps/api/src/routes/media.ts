// W8: owner-uploaded ad media + per-product branding. Uploaded images become
// ready creative variants (hookType "uploaded") that launch alongside the
// generated ones and join rotation/optimization like any other variant.
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const ALLOWED: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};
const MAX_BYTES = 3 * 1024 * 1024;

const uploadBody = z.object({
  filename: z.string().min(1),
  content_base64: z.string().min(1),
});

const brandBody = z.object({
  logoUrl: z.string().optional(),
  primaryColor: z.string().optional(),
  font: z.string().optional(),
  tone: z.string().optional(),
});

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>("/v1/products/:id/media", async (req, reply) => {
    const product = await app.repos.products.get(req.params.id);
    if (!product) return reply.status(404).send({ error: "not_found" });
    const parsed = uploadBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_body" });
    const ext = parsed.data.filename.split(".").pop()?.toLowerCase() ?? "";
    const mime = ALLOWED[ext];
    if (!mime) return reply.status(400).send({ error: "unsupported_type", allowed: Object.keys(ALLOWED) });
    const bytes = Buffer.from(parsed.data.content_base64, "base64");
    if (bytes.length === 0 || bytes.length > MAX_BYTES) {
      return reply.status(400).send({ error: "bad_size", maxBytes: MAX_BYTES });
    }

    const asset = await app.repos.media.insert(product.id, mime, bytes.toString("base64"));
    const existing = await app.repos.creatives.byProduct(product.id);
    const variantNo = Math.max(0, ...existing.map((c) => c.variantNo)) + 1;
    const creative = await app.repos.creatives.insert({
      productId: product.id,
      variantNo,
      format: "1:1",
      assetType: "image",
      assetRef: `/media/${asset.id}`,
      payload: { headline: product.title, body: "", hookType: "uploaded" },
      contentId: product.id,
      status: "ready",
    });
    return reply.status(201).send({
      creative: {
        id: creative.id,
        variantNo: creative.variantNo,
        format: creative.format,
        assetRef: creative.assetRef,
        headline: creative.payload.headline,
        body: creative.payload.body,
        status: creative.status,
      },
    });
  });

  // Public: referenced by previews and (in live mode) creative uploads.
  app.get<{ Params: { id: string } }>("/media/:id", async (req, reply) => {
    const asset = await app.repos.media.get(req.params.id);
    if (!asset) return reply.status(404).send({ error: "not_found" });
    return reply
      .header("content-type", asset.mime)
      .header("cache-control", "public, max-age=31536000, immutable")
      .send(Buffer.from(asset.dataBase64, "base64"));
  });

  // Per-product brand (W8): each page carries its own brand; the global kit
  // in Settings is only the default for new pages.
  app.post<{ Params: { id: string } }>("/v1/products/:id/brand", async (req, reply) => {
    const product = await app.repos.products.get(req.params.id);
    if (!product) return reply.status(404).send({ error: "not_found" });
    const parsed = brandBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: "invalid_body" });
    const merged: Record<string, string> = { ...(product.brandKit ?? {}) };
    for (const [k, v] of Object.entries(parsed.data)) {
      if (typeof v === "string") {
        if (v.trim() === "") delete merged[k];
        else merged[k] = v.trim();
      }
    }
    const updated = await app.repos.products.update(product.id, { brandKit: merged });
    return { brandKit: updated.brandKit ?? {} };
  });
}
