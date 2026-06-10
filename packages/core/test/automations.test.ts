// GATE G9: stock-out pauses within one sync cycle; promo expiry pulls its
// creative; expired token triggers refresh-then-attention; warm-up caps a
// young account's budget step; calendar pacing adjusts with a logged "why".
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createRepos, type Campaign, type Db, type Product, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import { createBillingChecker, createPlatformAdapters } from "@engine/adapters";
import {
  activeCalendarWindows,
  accountAgeDays,
  applyCalendarPacing,
  expirePromos,
  guardedExecute,
  processProductChanges,
  runBillingHealth,
  type UpdateCampaignAction,
} from "../src/index.js";

let db: Db;
let repos: Repos;
let adapters: ReturnType<typeof createPlatformAdapters>;

async function productWithCampaign(opts: { budget?: string; autonomous?: boolean } = {}): Promise<{
  product: Product;
  campaign: Campaign;
}> {
  const product = await repos.products.insert({
    mode: "catalog",
    title: `Auto-${Math.random().toString(36).slice(2, 8)}`,
    images: [],
    status: "autonomous",
    availability: "in_stock",
  });
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
  const campaign = await repos.campaigns.insertIdempotent({
    specId: spec.id,
    platform: "meta",
    platformCampaignId: `stub_meta_${Math.random().toString(36).slice(2, 10)}`,
    campaignType: "advantage_plus",
    objective: "purchases",
    optimizationEvent: "Purchase",
    budget: opts.budget ?? "300.0000",
    status: "autonomous",
    learningState: "exited",
    allocationAutonomous: opts.autonomous ?? true,
  });
  return { product, campaign };
}

beforeAll(async () => {
  db = await resetTestDb();
  repos = createRepos(db);
  adapters = createPlatformAdapters({ repos, mode: "stub" });
}, 30_000);

afterAll(async () => {
  await closeDb(db);
});

describe("stock/price auto-actions (GATE G9)", () => {
  it("stock-out pauses the product's ads within one sweep", async () => {
    const { product, campaign } = await productWithCampaign();
    await repos.productChanges.insert({
      productId: product.id,
      changeType: "stock_out",
      before: { availability: "in_stock" },
      after: { availability: "out_of_stock" },
    });
    const report = await processProductChanges({ repos, adapters });
    expect(report.paused).toContain(campaign.id);
    expect((await repos.campaigns.get(campaign.id))?.status).toBe("paused");
    expect((await repos.products.get(product.id))?.status).toBe("paused");
    const decision = (await repos.decisions.list({ actionType: "pause_stock_out" })).find(
      (d) => d.productId === product.id,
    );
    expect(decision?.executed).toBe(true);
    expect(decision?.rationale).toContain("sold out");
    expect((await repos.productChanges.listUnprocessed()).length).toBe(0);
  });

  it("back-in-stock resumes paused ads", async () => {
    const { product, campaign } = await productWithCampaign();
    await repos.campaigns.update(campaign.id, { status: "paused" });
    await repos.productChanges.insert({
      productId: product.id,
      changeType: "back_in_stock",
      before: { availability: "out_of_stock" },
      after: { availability: "in_stock" },
    });
    const report = await processProductChanges({ repos, adapters });
    expect(report.resumed).toContain(campaign.id);
    expect((await repos.campaigns.get(campaign.id))?.status).toBe("learning");
  });

  it("price change flags price-bearing creatives for regeneration", async () => {
    const { product } = await productWithCampaign();
    const priced = await repos.creatives.insert({
      productId: product.id,
      variantNo: 1,
      format: "1:1",
      assetType: "image",
      assetRef: "stub://image/x/1080x1080",
      payload: { headline: "Now AED 240" },
      contentId: product.id,
      status: "launched",
      priceBearing: true,
    });
    const unpriced = await repos.creatives.insert({
      productId: product.id,
      variantNo: 2,
      format: "1:1",
      assetType: "image",
      assetRef: "stub://image/y/1080x1080",
      payload: { headline: "Comfort first" },
      contentId: product.id,
      status: "launched",
      priceBearing: false,
    });
    await repos.productChanges.insert({
      productId: product.id,
      changeType: "price_change",
      before: { price: 240 },
      after: { price: 199 },
    });
    const report = await processProductChanges({ repos, adapters });
    expect(report.flaggedCreatives).toContain(priced.id);
    expect((await repos.creatives.get(priced.id))?.status).toBe("expired");
    expect((await repos.creatives.get(unpriced.id))?.status).toBe("launched");
    const decision = (await repos.decisions.list({ actionType: "flag_price_creatives" })).find(
      (d) => d.productId === product.id,
    );
    expect(decision?.rationale).toContain("price changed");
  });
});

describe("promo expiry (GATE G9)", () => {
  it("an expired promo pulls its creative on time", async () => {
    const { product } = await productWithCampaign();
    const promo = await repos.promos.create({
      productId: product.id,
      label: "Summer sale",
      startsAt: new Date("2026-06-01T00:00:00Z"),
      endsAt: new Date("2026-06-08T00:00:00Z"),
    });
    const promoCreative = await repos.creatives.insert({
      productId: product.id,
      variantNo: 9,
      format: "1:1",
      assetType: "image",
      assetRef: "stub://image/promo/1080x1080",
      payload: { headline: "Summer sale — 20% off" },
      contentId: product.id,
      status: "launched",
      promoId: promo.id,
      priceBearing: true,
    });
    const result = await expirePromos(repos, new Date("2026-06-10T00:00:00Z"));
    expect(result.expiredPromos).toBe(1);
    expect(result.expiredCreatives).toContain(promoCreative.id);
    expect((await repos.creatives.get(promoCreative.id))?.status).toBe("expired");
    const decision = (await repos.decisions.list({ actionType: "expire_promo_creatives" }))[0];
    expect(decision?.rationale).toContain("Summer sale");
    // Idempotent: second run finds nothing.
    expect((await expirePromos(repos, new Date("2026-06-10T01:00:00Z"))).expiredPromos).toBe(0);
  });
});

describe("billing / connection health (GATE G9)", () => {
  it("an expired token triggers refresh; failed self-repair raises attention", async () => {
    const checker = createBillingChecker({
      mode: "stub",
      fixtures: {
        meta: { tokenValid: false, canRefresh: true, refreshSucceeds: true },
        google: { tokenValid: false, canRefresh: true, refreshSucceeds: false },
        tiktok: { tokenValid: true, billingOk: false },
      },
    });
    const result = await runBillingHealth(repos, checker);
    expect(result.refreshed).toContain("meta");
    expect(result.attention).toContain("google");
    expect(result.attention).toContain("tiktok");

    const refreshDecision = (await repos.decisions.list({ actionType: "token_refreshed" }))[0];
    expect(refreshDecision?.rationale).toContain("renewed itself");

    const open = await repos.attention.listOpen();
    expect(open.some((a) => a.kind === "connection_health" && a.targetRef === "platform:google")).toBe(true);
    expect(open.some((a) => a.kind === "billing_issue" && a.targetRef === "platform:tiktok")).toBe(true);

    expect((await repos.adAccounts.get("meta"))?.tokenValid).toBe(true);
    expect((await repos.adAccounts.get("google"))?.tokenValid).toBe(false);
  });
});

describe("new-account warm-up (GATE G9)", () => {
  it("caps a young account's budget step via the guardrail layer", async () => {
    await repos.adAccounts.upsert("meta", {
      platformCreatedAt: new Date(Date.now() - 5 * 86_400_000), // 5 days old
    });
    const age = await accountAgeDays(repos, "meta");
    expect(age).toBe(5);

    const { campaign } = await productWithCampaign({ budget: "380.0000" });
    const action: UpdateCampaignAction = {
      type: "update_campaign",
      platform: "meta",
      campaignId: campaign.id,
      platformCampaignId: campaign.platformCampaignId!,
      changes: { dailyBudget: 480 }, // above the 400 warm-up cap, within 30% step
    };
    const outcome = await guardedExecute(
      repos,
      {
        loop: "fast",
        worker: "pacing",
        actionType: "budget_change",
        targetRef: `campaign:${campaign.id}`,
        rationale: "ramp test",
        action,
        context: { currentBudget: 380, accountAgeDays: age },
      },
      (approved) => adapters.meta.updateCampaign(approved),
    );
    expect(outcome.executed).toBe(false);
    expect(outcome.blockedReasons?.[0]).toContain("warm-up");
  });
});

describe("calendar pacing (GATE G9)", () => {
  it("an active window adjusts pacing within bounds and the Decision shows why", async () => {
    const ramadanDay = new Date("2026-02-25T08:00:00Z");
    expect(activeCalendarWindows(ramadanDay).map((w) => w.name)).toContain("Ramadan");

    const { campaign } = await productWithCampaign({ budget: "300.0000", autonomous: true });
    const result = await applyCalendarPacing({ repos, adapters }, { now: ramadanDay });
    expect(result.adjusted).toContain(campaign.id);
    expect(Number((await repos.campaigns.get(campaign.id))?.budget)).toBe(360); // ×1.2, within 30% step

    const decision = (await repos.decisions.list({ actionType: "calendar_pacing" })).find(
      (d) => d.targetRef === `campaign:${campaign.id}`,
    );
    expect(decision?.rationale).toContain("Ramadan");
    expect(decision?.evidence.some((e) => e.metric === "calendar_window")).toBe(true);

    // One adjustment per window: re-running does not compound.
    const again = await applyCalendarPacing({ repos, adapters }, { now: ramadanDay });
    expect(again.adjusted).not.toContain(campaign.id);
    expect(Number((await repos.campaigns.get(campaign.id))?.budget)).toBe(360);
  });

  it("no adjustment outside any window", async () => {
    expect(activeCalendarWindows(new Date("2026-06-10T00:00:00Z")).length).toBe(0);
  });
});
