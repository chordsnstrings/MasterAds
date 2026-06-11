// W8: granular launch control — uploaded media become launchable variants,
// explicit selection holds the rest, per-product brand overrides the global
// kit, and the plan states how the thing was understood (correctable).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { closeDb, createRepos, type Db, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import { buildApp } from "../src/app.js";

let db: Db;
let repos: Repos;
let app: FastifyInstance;
let productId: string;
let specId: string;

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

beforeAll(async () => {
  db = await resetTestDb();
  repos = createRepos(db);
  app = await buildApp({ db, jobs: null });
  const product = await repos.products.insert({
    mode: "offer",
    title: "Villa deep-clean service",
    rawInput: "Professional villa deep-cleaning teams across Dubai, from AED 350.",
    images: [],
  });
  productId = product.id;
}, 30_000);

afterAll(async () => {
  await app.close();
  await closeDb(db);
});

describe("granular launch control (W8)", () => {
  it("plan states how the engine understood the thing; the choice is correctable", async () => {
    const first = await app.inject({
      method: "POST",
      url: `/v1/products/${productId}/plan`,
      payload: { disambiguation: "service" },
    });
    expect(first.statusCode).toBe(201);
    const plan = first.json() as { specId: string; understoodAs: string };
    expect(["lead_generation", "booking"]).toContain(plan.understoodAs);
    specId = plan.specId;

    const corrected = await app.inject({
      method: "POST",
      url: `/v1/products/${productId}/plan`,
      payload: { disambiguation: "product" },
    });
    expect((corrected.json() as { understoodAs: string }).understoodAs).toBe("ecommerce");
    // Settle on service for the rest of the suite.
    const back = await app.inject({
      method: "POST",
      url: `/v1/products/${productId}/plan`,
      payload: { disambiguation: "service", destination: { kind: "hosted_form", value: "hosted" } },
    });
    specId = (back.json() as { specId: string }).specId;
  });

  it("uploaded media becomes a ready, launchable variant served from /media", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/products/${productId}/media`,
      payload: { filename: "team.png", content_base64: PNG_1PX },
    });
    expect(res.statusCode).toBe(201);
    const { creative } = res.json() as { creative: { id: string; assetRef: string; status: string } };
    expect(creative.status).toBe("ready");
    expect(creative.assetRef).toMatch(/^\/media\//);

    const img = await app.inject({ method: "GET", url: creative.assetRef });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");

    const bad = await app.inject({
      method: "POST",
      url: `/v1/products/${productId}/media`,
      payload: { filename: "movie.gif", content_base64: PNG_1PX },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("video uploads become 9:16 video variants served with the right mime (W9)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/products/${productId}/media`,
      payload: { filename: "demo.mp4", content_base64: PNG_1PX },
    });
    expect(res.statusCode).toBe(201);
    const { creative } = res.json() as {
      creative: { assetType: string; format: string; assetRef: string };
    };
    expect(creative.assetType).toBe("video");
    expect(creative.format).toBe("9:16");
    const served = await app.inject({ method: "GET", url: creative.assetRef });
    expect(served.headers["content-type"]).toBe("video/mp4");

    // ~4MB image is over the image cap (bad_size, not a 413 body error).
    const big = Buffer.alloc(4 * 1024 * 1024, 7).toString("base64");
    const oversized = await app.inject({
      method: "POST",
      url: `/v1/products/${productId}/media`,
      payload: { filename: "big.png", content_base64: big },
    });
    expect(oversized.statusCode).toBe(400);
    expect((oversized.json() as { error: string }).error).toBe("bad_size");
  });

  it("launch honors explicit selection: unchosen ready ads are held, not launched", async () => {
    const gen = await app.inject({ method: "POST", url: `/v1/specs/${specId}/creatives` });
    expect(gen.statusCode).toBe(201);
    const all = await repos.creatives.byProduct(productId);
    const ready = all.filter((c) => c.status === "ready");
    expect(ready.length).toBeGreaterThan(3);
    const chosen = ready.slice(0, 2).map((c) => c.id);

    const launch = await app.inject({
      method: "POST",
      url: `/v1/specs/${specId}/launch`,
      payload: { creative_ids: chosen },
    });
    expect(launch.statusCode).toBe(201);

    const after = await repos.creatives.byProduct(productId);
    const launched = after.filter((c) => c.status === "launched").map((c) => c.id);
    expect(launched.sort()).toEqual(chosen.sort());
    expect(after.filter((c) => c.status === "held").length).toBe(ready.length - chosen.length);
  });

  it("per-product brand overrides the global kit and styles the hosted page", async () => {
    await repos.settings.set("brand_kit", { primaryColor: "#111111", tone: "calm" });
    const res = await app.inject({
      method: "POST",
      url: `/v1/products/${productId}/brand`,
      payload: { primaryColor: "#0A8754", logoUrl: "https://brand.example/logo.png" },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { brandKit: Record<string, string> }).brandKit.primaryColor).toBe("#0A8754");

    const page = await app.inject({ method: "GET", url: `/hosted/p/${productId}` });
    expect(page.body).toContain("#0A8754"); // this page's brand, not the default
    expect(page.body).toContain("https://brand.example/logo.png");
  });
});
