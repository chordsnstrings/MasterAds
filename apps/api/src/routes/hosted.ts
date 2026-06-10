// Hosted simple page & form (FLOW §6): the destination for users with no site.
// A deliberate exception to "the engine doesn't own landing pages" — because the
// engine controls this destination, it is also a measurement surface: views and
// form submissions flow into the conversion hub natively (G2), click IDs
// captured from the landing URL exactly as the contract requires.
import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { enqueueRelay, ingestConversion } from "@engine/core";

const HOSTED_SOURCE = "hosted-pages";

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

type Query = Record<string, string | undefined>;

function clickIdsFromQuery(q: Query): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["fbclid", "fbc", "fbp", "ttclid", "gclid", "gbraid", "wbraid"] as const) {
    const v = q[key];
    if (typeof v === "string" && v.length > 0) out[key] = v;
  }
  return out;
}

function pageShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;background:#F7F8FA;color:#16181D;margin:0;display:flex;justify-content:center}
  main{max-width:560px;width:100%;padding:24px}
  .card{background:#fff;border:1px solid #E7E9ED;border-radius:12px;padding:24px;margin-top:24px}
  h1{font-size:1.5rem;margin:0 0 8px}
  p{line-height:1.5;color:#444}
  .price{font-family:ui-monospace,monospace;font-size:1.25rem;margin:12px 0}
  img{max-width:100%;border-radius:8px}
  label{display:block;font-size:.875rem;margin-top:12px}
  input,textarea{width:100%;box-sizing:border-box;min-height:44px;border:1px solid #E7E9ED;border-radius:8px;padding:10px;font:inherit;margin-top:4px}
  button,.btn{display:inline-block;min-height:44px;background:#2F4BDA;color:#fff;border:0;border-radius:8px;padding:12px 24px;font:inherit;font-weight:500;margin-top:16px;cursor:pointer;text-decoration:none}
</style></head><body><main>${body}</main></body></html>`;
}

async function recordView(
  app: FastifyInstance,
  productId: string,
  query: Query,
): Promise<void> {
  const result = await ingestConversion(app.repos, {
    event_name: "ViewContent",
    event_time: Math.floor(Date.now() / 1000),
    click_ids: clickIdsFromQuery(query),
    hashed_identifiers: {},
    content_id: productId,
    event_id: `hp-view-${randomUUID()}`,
    source_site: HOSTED_SOURCE,
    consent_granted: true,
  });
  if (app.jobs && !result.duplicate && result.canonical) {
    await enqueueRelay(app.jobs, result.event.id);
  }
}

export async function hostedRoutes(app: FastifyInstance): Promise<void> {
  // Demo product page fixture (non-production): a realistic page the URL
  // intake can read end-to-end without external network.
  if (process.env.NODE_ENV !== "production") {
    app.get("/demo/product-page", async (_req, reply) => {
      return reply.type("text/html").send(`<!doctype html><html><head>
<title>Walnut Coffee Table — Demo Shop</title>
<meta property="og:title" content="Walnut Coffee Table" />
<meta property="og:description" content="Solid walnut coffee table, hand-finished, free delivery in Dubai." />
<meta property="og:image" content="https://demo.example/img/table.jpg" />
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Walnut Coffee Table","description":"Solid walnut coffee table, hand-finished, free delivery in Dubai.","image":["https://demo.example/img/table.jpg"],"offers":{"@type":"Offer","price":"950.00","priceCurrency":"AED","availability":"https://schema.org/InStock"}}</script>
</head><body><h1>Walnut Coffee Table</h1><div class="price">AED 950</div></body></html>`);
    });
  }

  // Simple page we make for you.
  app.get<{ Params: { id: string }; Querystring: Query }>(
    "/hosted/p/:id",
    async (req, reply) => {
      const product = await app.repos.products.get(req.params.id);
      if (!product) return reply.status(404).send("Not found");
      await recordView(app, product.id, req.query);
      const qs = new URLSearchParams(
        Object.entries(clickIdsFromQuery(req.query)) as [string, string][],
      ).toString();
      const img = product.images[0] ? `<img src="${product.images[0]}" alt="">` : "";
      return reply.type("text/html").send(
        pageShell(
          product.title,
          `<div class="card">${img}<h1>${product.title}</h1>
           ${product.price ? `<div class="price">${product.currency ?? "AED"} ${Number(product.price)}</div>` : ""}
           <p>${product.description ?? ""}</p>
           <a class="btn" href="/hosted/f/${product.id}${qs ? `?${qs}` : ""}">Get in touch</a></div>`,
        ),
      );
    },
  );

  // Form we make for you (collect enquiries).
  app.get<{ Params: { id: string }; Querystring: Query }>(
    "/hosted/f/:id",
    async (req, reply) => {
      const product = await app.repos.products.get(req.params.id);
      if (!product) return reply.status(404).send("Not found");
      await recordView(app, product.id, req.query);
      const clickIds = clickIdsFromQuery(req.query);
      const hidden = Object.entries(clickIds)
        .map(([k, v]) => `<input type="hidden" name="cid_${k}" value="${v}">`)
        .join("");
      return reply.type("text/html").send(
        pageShell(
          product.title,
          `<div class="card"><h1>${product.title}</h1><p>${product.description ?? ""}</p>
           <form method="post" action="/hosted/f/${product.id}/submit" data-testid="hosted-form">
             ${hidden}
             <label>Your name<input name="name" required></label>
             <label>Email<input name="email" type="email"></label>
             <label>Phone<input name="phone" type="tel"></label>
             <label>What are you looking for?<textarea name="message" rows="3"></textarea></label>
             <button type="submit">Send</button>
           </form></div>`,
        ),
      );
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/hosted/f/:id/submit",
    async (req, reply) => {
      const product = await app.repos.products.get(req.params.id);
      if (!product) return reply.status(404).send("Not found");
      const body = req.body ?? {};
      const clickIds: Record<string, string> = {};
      for (const [k, v] of Object.entries(body)) {
        if (k.startsWith("cid_") && v) clickIds[k.slice(4)] = v;
      }
      const hashed: Record<string, string> = {};
      if (body.email) hashed.email_sha256 = sha256(body.email.trim().toLowerCase());
      if (body.phone) hashed.phone_sha256 = sha256(body.phone.replace(/[^\d+]/g, ""));

      const result = await ingestConversion(app.repos, {
        event_name: "Lead",
        event_time: Math.floor(Date.now() / 1000),
        click_ids: clickIds,
        hashed_identifiers: hashed,
        content_id: product.id,
        event_id: `hf-lead-${randomUUID()}`,
        source_site: HOSTED_SOURCE,
        consent_granted: true,
      });
      if (app.jobs && !result.duplicate && result.canonical) {
        await enqueueRelay(app.jobs, result.event.id);
      }
      return reply
        .type("text/html")
        .send(
          pageShell(
            product.title,
            `<div class="card"><h1>Thanks — we'll be in touch.</h1><p data-testid="form-thanks">Your message about ${product.title} was sent.</p></div>`,
          ),
        );
    },
  );
}
