// GATE G7: the insights job ingests fixture reports and writes ad_spend
// CostEvents; idempotent per (campaign, date).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createRepos, type Campaign, type Db, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import { createPlatformAdapters } from "@engine/adapters";
import { runInsightsPull } from "../src/jobs/insights.js";

let db: Db;
let repos: Repos;
let campaign: Campaign;

beforeAll(async () => {
  db = await resetTestDb();
  repos = createRepos(db);
  const product = await repos.products.insert({ mode: "catalog", title: "Insights P", images: [] });
  const spec = await repos.specs.insert({
    productId: product.id,
    businessModel: "ecommerce",
    terminalEvent: "Purchase",
    optimizationEvent: "Purchase",
    funnelStages: ["ViewContent", "Purchase"],
    priceTier: "mid",
    creativeAngle: "lifestyle",
    policyCategory: "standard",
    targetPlatforms: ["meta"],
    audienceStrategy: "broad_platform_ai",
    formatMix: ["1:1"],
  });
  campaign = await repos.campaigns.insertIdempotent({
    specId: spec.id,
    platform: "meta",
    platformCampaignId: "stub_meta_insights1",
    campaignType: "advantage_plus",
    objective: "purchases",
    optimizationEvent: "Purchase",
    budget: "500.0000",
    status: "learning",
  });
}, 30_000);

afterAll(async () => {
  await closeDb(db);
});

describe("insights pull (GATE G7)", () => {
  it("ingests fixture reports and writes ad_spend CostEvents", async () => {
    const adapters = createPlatformAdapters({
      repos,
      mode: "stub",
      insightsFixtures: {
        "stub_meta_insights1:2026-06-09": {
          date: "2026-06-09",
          spend: 480,
          impressions: 60_000,
          clicks: 1200,
          conversions: 24,
          revenue: 7200,
          currency: "AED",
        },
      },
    });
    const result = await runInsightsPull(repos, adapters, "2026-06-09");
    expect(result.pulled).toBe(1);
    expect(result.costEvents).toBe(1);

    const rows = await repos.insights.byCampaign(campaign.id);
    expect(rows.length).toBe(1);
    expect(Number(rows[0]?.spend)).toBe(480);
    expect(rows[0]?.conversions).toBe(24);

    const costs = await repos.costs.list({ costType: "ad_spend" });
    expect(costs.length).toBe(1);
    expect(Number(costs[0]?.amount)).toBe(480);
    expect(costs[0]?.campaignId).toBe(campaign.id);
    expect(costs[0]?.productId).not.toBeNull();
  });

  it("re-running the same day is idempotent (no duplicate cost events)", async () => {
    const adapters = createPlatformAdapters({ repos, mode: "stub" });
    const again = await runInsightsPull(repos, adapters, "2026-06-09");
    expect(again.costEvents).toBe(0);
    expect((await repos.costs.list({ costType: "ad_spend" })).length).toBe(1);
    expect((await repos.insights.byCampaign(campaign.id)).length).toBe(1);
  });
});
