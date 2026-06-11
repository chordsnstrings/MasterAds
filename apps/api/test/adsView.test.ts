// W9: per-ad insights — ad-level facts from creative rows; "what's winning"
// from playbook share-of-credit priors; never fabricated platform metrics.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { closeDb, createRepos, type Db, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import { seedPlaybooks } from "@engine/core";
import { buildApp } from "../src/app.js";

let db: Db;
let repos: Repos;
let app: FastifyInstance;
let productId: string;

beforeAll(async () => {
  db = await resetTestDb();
  repos = createRepos(db);
  await seedPlaybooks(repos);
  app = await buildApp({ db, jobs: null });
  const playbook = (await repos.playbooks.byVertical("ecommerce_physical_goods"))!;
  await repos.playbooks.updatePriors(playbook.id, { "hook:benefit": 0.6, "hook:urgency": 0.4 });
  const product = await repos.products.insert({
    mode: "catalog",
    title: "Ads view P",
    vertical: "ecommerce_physical_goods",
    images: [],
  });
  productId = product.id;
  await repos.specs.insert({
    productId,
    playbookId: playbook.id,
    businessModel: "ecommerce",
    terminalEvent: "Purchase",
    optimizationEvent: "Purchase",
    funnelStages: ["ViewContent", "Purchase"],
    priceTier: "mid",
    creativeAngle: "lifestyle",
    policyCategory: "standard",
    targetPlatforms: ["meta"],
    audienceStrategy: "broad_platform_ai",
    formatMix: ["1:1", "9:16"],
  });
  await repos.creatives.insert({
    productId,
    variantNo: 1,
    format: "1:1",
    assetType: "image",
    assetRef: "stub://image/a",
    payload: { headline: "H1", hookType: "benefit" },
    contentId: productId,
    predictedScore: "0.8000",
    status: "launched",
  });
  await repos.creatives.insert({
    productId,
    variantNo: 1,
    format: "9:16",
    assetType: "video",
    assetRef: "stub://video/a/1080x1920/15s",
    payload: { headline: "H1", hookType: "benefit", durationSeconds: "15" },
    contentId: productId,
    status: "held",
  });
  await repos.creatives.insert({
    productId,
    variantNo: 2,
    format: "1:1",
    assetType: "image",
    assetRef: "stub://image/b",
    payload: { headline: "No hook" }, // legacy row without hookType
    contentId: productId,
    status: "ready",
  });
}, 30_000);

afterAll(async () => {
  await app.close();
  await closeDb(db);
});

describe("per-ad insights (W9)", () => {
  it("detail returns ad-level facts and the winning-hook leaderboard", async () => {
    const res = await app.inject({ method: "GET", url: `/internal/products/${productId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      ads: { assetType: string; hookType: string | null; fatigueState: string; durationSeconds: string | null }[];
      winning: { hook: string; sharePct: number }[];
    };
    expect(body.ads.length).toBe(3);
    const video = body.ads.find((a) => a.assetType === "video")!;
    expect(video.durationSeconds).toBe("15");
    expect(body.ads.some((a) => a.hookType === null)).toBe(true); // legacy rows tolerated
    expect(body.ads.every((a) => ["fresh", "tiring", "fatigued"].includes(a.fatigueState))).toBe(true);
    expect(body.winning).toEqual([
      { hook: "benefit", sharePct: 60 },
      { hook: "urgency", sharePct: 40 },
    ]);
  });
});
