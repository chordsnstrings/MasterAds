// GATE G10 simulation: the medium loop shifts budget toward the higher
// net-return campaign within guardrail step limits and logs predicted
// outcomes; fatigued creative rotates; a thin product deepens its event when
// volume rises; scoring fills outcomes after the window.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createRepos, newId, type Campaign, type Db, type Product, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import { createPlatformAdapters } from "@engine/adapters";
import {
  detectFatigue,
  reevaluateOptimizationEvents,
  runFatigueSweep,
  runMediumLoopOnce,
  scoreDecisions,
} from "../src/index.js";

let db: Db;
let repos: Repos;
let adapters: ReturnType<typeof createPlatformAdapters>;
const NOW = new Date("2026-06-10T06:00:00Z");

interface Slice {
  product: Product;
  campaign: Campaign;
}

async function makeSlice(opts: {
  budget: number;
  autonomous: boolean;
  optimizationEvent?: string;
}): Promise<Slice> {
  const product = await repos.products.insert({
    mode: "catalog",
    title: `Slice-${Math.random().toString(36).slice(2, 8)}`,
    images: [],
    status: "autonomous",
  });
  const spec = await repos.specs.insert({
    productId: product.id,
    businessModel: "ecommerce",
    terminalEvent: "Purchase",
    optimizationEvent: opts.optimizationEvent ?? "Purchase",
    funnelStages: ["ViewContent", "AddToCart", "InitiateCheckout", "Purchase"],
    priceTier: "mid",
    creativeAngle: "lifestyle",
    policyCategory: "standard",
    targetPlatforms: ["meta"],
    audienceStrategy: "broad_platform_ai",
    formatMix: ["1:1"],
  });
  const campaign = await repos.campaigns.insertIdempotent({
    specId: spec.id,
    platform: "meta",
    platformCampaignId: `stub_meta_${Math.random().toString(36).slice(2, 10)}`,
    campaignType: "advantage_plus",
    objective: "purchases",
    optimizationEvent: opts.optimizationEvent ?? "Purchase",
    budget: opts.budget.toFixed(4),
    status: "autonomous",
    learningState: "exited",
    allocationAutonomous: opts.autonomous,
  });
  return { product, campaign };
}

async function fund(slice: Slice, opts: { adSpend: number; revenue: number; opCost?: number }) {
  await repos.costs.insert({
    costType: "ad_spend",
    providerOrPlatform: "meta",
    units: {},
    amount: opts.adSpend.toFixed(6),
    currency: "AED",
    productId: slice.product.id,
    campaignId: slice.campaign.id,
    occurredAt: new Date(NOW.getTime() - 86_400_000),
  });
  if (opts.opCost) {
    await repos.costs.insert({
      costType: "ai_inference",
      operation: "creative_image",
      providerOrPlatform: "stub-creative",
      units: { images: 1 },
      amount: opts.opCost.toFixed(6),
      currency: "USD",
      productId: slice.product.id,
      occurredAt: new Date(NOW.getTime() - 86_400_000),
    });
  }
  // Revenue as canonical conversions.
  const n = Math.max(1, Math.round(opts.revenue / 500));
  for (let i = 0; i < n; i++) {
    await repos.conversions.insertIdempotent({
      eventName: "Purchase",
      eventTime: new Date(NOW.getTime() - (i + 1) * 3_600_000),
      value: (opts.revenue / n).toFixed(4),
      currency: "AED",
      contentId: slice.product.id,
      eventId: `rev-${slice.product.id}-${i}`,
      sourceSite: "sim-shop",
      dedupKey: newId("dk"),
      reconciliationKey: newId("rk"),
      canonical: true,
    });
  }
}

beforeAll(async () => {
  db = await resetTestDb();
  repos = createRepos(db);
  adapters = createPlatformAdapters({ repos, mode: "stub" });
}, 30_000);

afterAll(async () => {
  await closeDb(db);
});

describe("medium loop allocation (GATE G10)", () => {
  it("shifts budget toward the higher net-return slice within step limits, logging predicted outcomes", async () => {
    const strong = await makeSlice({ budget: 500, autonomous: true });
    const weak = await makeSlice({ budget: 400, autonomous: true });
    await fund(strong, { adSpend: 3000, revenue: 12_000, opCost: 5 }); // ~4× net
    await fund(weak, { adSpend: 2800, revenue: 1_400, opCost: 5 }); // ~0.5× net

    const report = await runMediumLoopOnce({ repos, adapters }, { now: NOW });
    expect(report.executedMoves.length).toBe(2);

    const weakAfter = await repos.campaigns.get(weak.campaign.id);
    const strongAfter = await repos.campaigns.get(strong.campaign.id);
    expect(Number(weakAfter?.budget)).toBeLessThan(400);
    expect(Number(strongAfter?.budget)).toBeGreaterThan(500);
    // Within the 20% step limit.
    expect(Number(weakAfter?.budget)).toBeGreaterThanOrEqual(400 * 0.8 - 1);
    expect(Number(strongAfter?.budget)).toBeLessThanOrEqual(500 * 1.2 + 1);

    const decisions = await repos.decisions.list({ actionType: "budget_change" });
    const up = decisions.find((d) => d.targetRef === `campaign:${strong.campaign.id}`);
    expect(up?.predictedOutcome).toContain("net return improves");
    expect(up?.rationale).toContain("total cost");
    expect(up?.executed).toBe(true);
  });

  it("slices below the signal threshold get propose-only decisions", async () => {
    await db.$pool.query("DELETE FROM campaign_insights");
    // Fresh pair: winner not yet auto-promoted.
    const strong = await makeSlice({ budget: 300, autonomous: false });
    const weak = await makeSlice({ budget: 300, autonomous: true });
    await fund(strong, { adSpend: 1000, revenue: 9000 });
    await fund(weak, { adSpend: 1000, revenue: 500 });

    const report = await runMediumLoopOnce({ repos, adapters }, { now: NOW });
    const proposed = report.proposedMoves.find((m) => m.campaignId === strong.campaign.id);
    expect(proposed).toBeDefined();
    // Budget unchanged; Decision exists with executed=false.
    expect(Number((await repos.campaigns.get(strong.campaign.id))?.budget)).toBe(300);
    const decision = (await repos.decisions.list({ actionType: "budget_change" })).find(
      (d) => d.targetRef === `campaign:${strong.campaign.id}` && !d.executed,
    );
    expect(decision).toBeDefined();
  });
});

describe("creative fatigue (GATE G10)", () => {
  it("detects CTR decay and rotates a fatigued creative to a held variant", async () => {
    const slice = await makeSlice({ budget: 300, autonomous: true });
    const launched = await repos.creatives.insert({
      productId: slice.product.id,
      variantNo: 1,
      format: "1:1",
      assetType: "image",
      assetRef: "stub://image/a",
      payload: { headline: "Old ad" },
      contentId: slice.product.id,
      status: "launched",
    });
    const held = await repos.creatives.insert({
      productId: slice.product.id,
      variantNo: 2,
      format: "1:1",
      assetType: "image",
      assetRef: "stub://image/b",
      payload: { headline: "Fresh ad" },
      contentId: slice.product.id,
      status: "held",
    });
    // 6 days: CTR 2% → 0.6% (decay > 40%).
    const days = ["04", "05", "06", "07", "08", "09"];
    for (let i = 0; i < days.length; i++) {
      const ctr = i < 3 ? 0.02 : 0.006;
      await repos.insights.insertIdempotent({
        campaignId: slice.campaign.id,
        date: `2026-06-${days[i]}`,
        spend: "300.0000",
        impressions: 50_000,
        clicks: Math.round(50_000 * ctr),
        conversions: 5,
        revenue: "2500.0000",
        currency: "AED",
      });
    }
    const verdict = detectFatigue(await repos.insights.byCampaign(slice.campaign.id));
    expect(verdict.fatigued).toBe(true);

    const sweep = await runFatigueSweep(repos);
    expect(sweep.rotated).toContain(slice.product.id);
    expect((await repos.creatives.get(launched.id))?.status).toBe("retired");
    expect((await repos.creatives.get(held.id))?.status).toBe("launched");
    const decision = (await repos.decisions.list({ actionType: "rotate_creatives" })).find(
      (d) => d.productId === slice.product.id,
    );
    expect(decision?.rationale).toContain("Replaced");
  });

  it("requests regeneration when the held pool is exhausted", async () => {
    const slice = await makeSlice({ budget: 300, autonomous: true });
    await repos.creatives.insert({
      productId: slice.product.id,
      variantNo: 1,
      format: "1:1",
      assetType: "image",
      assetRef: "stub://image/only",
      payload: { headline: "Only ad" },
      contentId: slice.product.id,
      status: "launched",
    });
    const { rotateCreatives } = await import("../src/loops/creativeLifecycle.js");
    const report = await rotateCreatives(repos, slice.product.id, "test exhaustion");
    expect(report.regenerationRequested).toBe(true);
    const decision = (await repos.decisions.list({ actionType: "request_regeneration" })).find(
      (d) => d.productId === slice.product.id,
    );
    expect(decision).toBeDefined();
  });
});

describe("event re-evaluation (GATE G10)", () => {
  it("a thin product deepens its optimization event when measured volume clears the threshold", async () => {
    const slice = await makeSlice({ budget: 300, autonomous: true, optimizationEvent: "AddToCart" });
    // 60 real purchases this week.
    for (let i = 0; i < 60; i++) {
      await repos.conversions.insertIdempotent({
        eventName: "Purchase",
        eventTime: new Date(NOW.getTime() - i * 3_600_000),
        value: "100.0000",
        currency: "AED",
        contentId: slice.product.id,
        eventId: `deep-${slice.product.id}-${i}`,
        sourceSite: "sim-shop",
        dedupKey: newId("dk"),
        reconciliationKey: newId("rk"),
        canonical: true,
      });
    }
    const result = await reevaluateOptimizationEvents({ repos, adapters }, { now: NOW });
    const deepened = result.deepened.find((d) => d.specId === slice.campaign.specId);
    expect(deepened).toEqual({ specId: slice.campaign.specId, from: "AddToCart", to: "Purchase" });
    expect((await repos.specs.get(slice.campaign.specId))?.optimizationEvent).toBe("Purchase");
    expect((await repos.campaigns.get(slice.campaign.id))?.optimizationEvent).toBe("Purchase");
  });
});

describe("outcome scoring (GATE G10)", () => {
  it("fills actual_outcome and scored_delta after the observation window", async () => {
    const slice = await makeSlice({ budget: 300, autonomous: true });
    // A budget_change decision made 5 days ago.
    const decision = await repos.decisions.insert({
      loop: "medium",
      worker: "allocation",
      actionType: "budget_change",
      targetRef: `campaign:${slice.campaign.id}`,
      rationale: "raise",
      predictedOutcome: "+20% conversions",
      guardrailStatus: "passed",
      executed: true,
      productId: slice.product.id,
      createdAt: new Date("2026-06-05T06:00:00Z"),
    });
    // Insights: 5/day before, 8/day after.
    const series = [
      { date: "2026-06-02", conversions: 5 },
      { date: "2026-06-03", conversions: 5 },
      { date: "2026-06-04", conversions: 5 },
      { date: "2026-06-05", conversions: 8 },
      { date: "2026-06-06", conversions: 8 },
      { date: "2026-06-07", conversions: 8 },
    ];
    for (const s of series) {
      await repos.insights.insertIdempotent({
        campaignId: slice.campaign.id,
        date: s.date,
        spend: "300.0000",
        impressions: 10_000,
        clicks: 200,
        conversions: s.conversions,
        revenue: "2000.0000",
        currency: "AED",
      });
    }
    const { scored } = await scoreDecisions(repos, { now: NOW, observationDays: 3 });
    expect(scored).toBeGreaterThan(0);
    const outcomes = await repos.decisions.outcomesFor(decision.id);
    expect(outcomes.length).toBe(1);
    expect(outcomes[0]?.actualOutcome).toContain("5.0 → 8.0");
    expect(Number(outcomes[0]?.scoredDelta)).toBeCloseTo(0.6, 1);
  });
});
