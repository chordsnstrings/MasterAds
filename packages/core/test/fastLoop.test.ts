// GATE G8: guardrail blocking; kill switch halts within one iteration;
// zero-conversion burn pausing with Decision rationale; auto-promotion at the
// signal threshold; dry-run writes Decisions without mutating.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createRepos, type Campaign, type Db, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import { createPlatformAdapters } from "@engine/adapters";
import { guardedExecute, runFastLoopOnce, type UpdateCampaignAction } from "../src/index.js";

let db: Db;
let repos: Repos;
let adapters: ReturnType<typeof createPlatformAdapters>;
const NOW = new Date("2026-06-10T10:00:00Z");

async function makeCampaign(
  overrides: { budget?: string; allocationAutonomous?: boolean } = {},
): Promise<Campaign> {
  const product = await repos.products.insert({
    mode: "catalog",
    title: `P-${Math.random().toString(36).slice(2, 8)}`,
    images: [],
    status: "learning",
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
  return repos.campaigns.insertIdempotent({
    specId: spec.id,
    platform: "meta",
    platformCampaignId: `stub_meta_${Math.random().toString(36).slice(2, 10)}`,
    campaignType: "advantage_plus",
    objective: "purchases",
    optimizationEvent: "Purchase",
    budget: overrides.budget ?? "500.0000",
    status: "learning",
    learningState: "learning",
    allocationAutonomous: overrides.allocationAutonomous ?? false,
  });
}

async function addInsights(
  campaignId: string,
  rows: { date: string; spend: number; conversions: number }[],
): Promise<void> {
  for (const r of rows) {
    await repos.insights.insertIdempotent({
      campaignId,
      date: r.date,
      spend: r.spend.toFixed(4),
      impressions: r.spend * 100,
      clicks: Math.round(r.spend),
      conversions: r.conversions,
      revenue: (r.conversions * 100).toFixed(4),
      currency: "AED",
    });
  }
}

beforeAll(async () => {
  db = await resetTestDb();
  repos = createRepos(db);
  adapters = createPlatformAdapters({ repos, mode: "stub" });
}, 30_000);

beforeEach(async () => {
  await repos.killSwitch.set(false);
});

afterAll(async () => {
  await closeDb(db);
});

describe("guardrails (GATE G8)", () => {
  it("a budget change exceeding the max step is blocked and logged", async () => {
    const campaign = await makeCampaign();
    const action: UpdateCampaignAction = {
      type: "update_campaign",
      platform: "meta",
      campaignId: campaign.id,
      platformCampaignId: campaign.platformCampaignId!,
      changes: { dailyBudget: 900 }, // +80% vs the 30% max step
    };
    const outcome = await guardedExecute(
      repos,
      {
        loop: "medium",
        worker: "allocation",
        actionType: "budget_change",
        targetRef: `campaign:${campaign.id}`,
        rationale: "test budget jump",
        action,
        context: { currentBudget: 500 },
      },
      (approved) => adapters.meta.updateCampaign(approved),
    );
    expect(outcome.executed).toBe(false);
    expect(outcome.decision.guardrailStatus).toBe("blocked");
    expect(outcome.blockedReasons?.[0]).toContain("max change per step");
    const logged = await repos.decisions.get(outcome.decision.id);
    expect(logged?.rationale).toContain("blocked");
  });

  it("a compliant budget change passes and executes", async () => {
    const campaign = await makeCampaign();
    const action: UpdateCampaignAction = {
      type: "update_campaign",
      platform: "meta",
      campaignId: campaign.id,
      platformCampaignId: campaign.platformCampaignId!,
      changes: { dailyBudget: 600 }, // +20%
    };
    const outcome = await guardedExecute(
      repos,
      {
        loop: "medium",
        worker: "allocation",
        actionType: "budget_change",
        targetRef: `campaign:${campaign.id}`,
        rationale: "modest raise",
        action,
        context: { currentBudget: 500 },
      },
      (approved) => adapters.meta.updateCampaign(approved),
    );
    expect(outcome.executed).toBe(true);
    expect(outcome.decision.executed).toBe(true);
  });
});

describe("fast loop (GATE G8)", () => {
  it("kill switch halts the loop within one iteration — no writes, no decisions", async () => {
    const campaign = await makeCampaign();
    await addInsights(campaign.id, [
      { date: "2026-06-09", spend: 600, conversions: 0 },
      { date: "2026-06-10", spend: 700, conversions: 0 },
    ]);
    const decisionsBefore = (await repos.decisions.list()).length;
    await repos.killSwitch.set(true);
    const report = await runFastLoopOnce({ repos, adapters }, { now: NOW });
    expect(report.halted).toBe(true);
    expect(report.checked).toBe(0);
    expect((await repos.decisions.list()).length).toBe(decisionsBefore);
    expect((await repos.campaigns.get(campaign.id))?.status).toBe("learning");
  });

  it("pauses a campaign burning spend with zero conversions and logs the Decision with rationale", async () => {
    const campaign = await makeCampaign({ budget: "500.0000" });
    await addInsights(campaign.id, [
      { date: "2026-06-09", spend: 500, conversions: 0 },
      { date: "2026-06-10", spend: 400, conversions: 0 },
    ]);
    const report = await runFastLoopOnce({ repos, adapters }, { now: NOW });
    expect(report.paused).toContain(campaign.id);
    expect((await repos.campaigns.get(campaign.id))?.status).toBe("paused");
    const decision = (await repos.decisions.list({ actionType: "pause_zero_conversion" })).find(
      (d) => d.targetRef === `campaign:${campaign.id}`,
    );
    expect(decision).toBeDefined();
    expect(decision?.rationale).toContain("no results");
    expect(decision?.evidence.some((e) => e.metric === "conversions" && e.result === "0")).toBe(
      true,
    );
    expect(decision?.executed).toBe(true);
  });

  it("a spend anomaly trips the circuit breaker and raises attention", async () => {
    const campaign = await makeCampaign({ budget: "300.0000" });
    await addInsights(campaign.id, [
      { date: "2026-06-06", spend: 280, conversions: 5 },
      { date: "2026-06-07", spend: 300, conversions: 6 },
      { date: "2026-06-08", spend: 290, conversions: 4 },
      { date: "2026-06-09", spend: 310, conversions: 6 },
      { date: "2026-06-10", spend: 2400, conversions: 5 }, // 8× plan
    ]);
    const report = await runFastLoopOnce({ repos, adapters }, { now: NOW });
    expect(report.anomalies).toContain(campaign.id);
    expect((await repos.campaigns.get(campaign.id))?.status).toBe("paused");
    const attention = await repos.attention.listOpen();
    expect(
      attention.some(
        (a) => a.kind === "spend_anomaly" && a.targetRef === `campaign:${campaign.id}`,
      ),
    ).toBe(true);
  });

  it("a slice crossing the signal threshold auto-promotes", async () => {
    const campaign = await makeCampaign({ budget: "500.0000" });
    await addInsights(campaign.id, [
      { date: "2026-06-07", spend: 450, conversions: 18 },
      { date: "2026-06-08", spend: 480, conversions: 17 },
      { date: "2026-06-09", spend: 470, conversions: 16 },
      { date: "2026-06-10", spend: 460, conversions: 12 },
    ]);
    const report = await runFastLoopOnce({ repos, adapters }, { now: NOW });
    expect(report.promoted).toContain(campaign.id);
    const after = await repos.campaigns.get(campaign.id);
    expect(after?.allocationAutonomous).toBe(true);
    expect(after?.promotedAt).not.toBeNull();
    expect(after?.status).toBe("autonomous");
    expect(after?.learningState).toBe("exited"); // 63 weekly conversions
    const decision = (
      await repos.decisions.list({ actionType: "promote_allocation_authority" })
    ).find((d) => d.targetRef === `campaign:${campaign.id}`);
    expect(decision?.rationale).toContain("within your limits");

    // Below-threshold slices stay un-promoted.
    const thin = await makeCampaign();
    await addInsights(thin.id, [{ date: "2026-06-10", spend: 100, conversions: 3 }]);
    await runFastLoopOnce({ repos, adapters }, { now: NOW });
    expect((await repos.campaigns.get(thin.id))?.allocationAutonomous).toBe(false);
  });

  it("dry-run writes Decisions without mutating anything", async () => {
    const campaign = await makeCampaign({ budget: "500.0000" });
    await addInsights(campaign.id, [
      { date: "2026-06-09", spend: 600, conversions: 0 },
      { date: "2026-06-10", spend: 500, conversions: 0 },
    ]);
    const report = await runFastLoopOnce({ repos, adapters }, { now: NOW, dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.paused).toContain(campaign.id);
    // Nothing mutated…
    expect((await repos.campaigns.get(campaign.id))?.status).toBe("learning");
    // …but the proposal exists in the Decision log with executed=false.
    const decision = (await repos.decisions.list({ actionType: "pause_zero_conversion" })).find(
      (d) => d.targetRef === `campaign:${campaign.id}`,
    );
    expect(decision).toBeDefined();
    expect(decision?.executed).toBe(false);
  });

  it("lifecycle: launching → learning on first delivery; learning exits at threshold", async () => {
    const campaign = await makeCampaign();
    await repos.campaigns.update(campaign.id, { status: "launching", learningState: "pending" });
    await addInsights(campaign.id, [{ date: "2026-06-10", spend: 120, conversions: 2 }]);
    await runFastLoopOnce({ repos, adapters }, { now: NOW });
    const after = await repos.campaigns.get(campaign.id);
    expect(after?.status).toBe("learning");
    expect(after?.learningState).toBe("learning");
  });
});
