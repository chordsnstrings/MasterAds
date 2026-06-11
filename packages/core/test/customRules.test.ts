// W9: user-defined automation rules — deterministic, guardrail-gated, with
// cooldown anti-flapping; notify raises attention + queues an email; the kill
// switch and dry-run are honored end to end.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createRepos, type Campaign, type Db, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import { createPlatformAdapters } from "@engine/adapters";
import { runCustomRulesOnce, runFastLoopOnce } from "../src/index.js";

let db: Db;
let repos: Repos;
let adapters: ReturnType<typeof createPlatformAdapters>;
const NOW = new Date("2026-06-10T10:00:00Z");

async function makeCampaign(
  overrides: { budget?: string; status?: Campaign["status"]; title?: string } = {},
): Promise<{ campaign: Campaign; productId: string }> {
  const product = await repos.products.insert({
    mode: "catalog",
    title: overrides.title ?? `P-${Math.random().toString(36).slice(2, 8)}`,
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
  const campaign = await repos.campaigns.insertIdempotent({
    specId: spec.id,
    platform: "meta",
    platformCampaignId: `stub_meta_${Math.random().toString(36).slice(2, 10)}`,
    campaignType: "advantage_plus",
    objective: "purchases",
    optimizationEvent: "Purchase",
    budget: overrides.budget ?? "500.0000",
    status: overrides.status ?? "learning",
    learningState: "learning",
  });
  return { campaign, productId: product.id };
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
  for (const r of await repos.automationRules.list()) {
    await repos.automationRules.delete(r.id);
  }
});

afterAll(async () => {
  await closeDb(db);
});

describe("custom rules (W9)", () => {
  it("a spend rule fires through the guardrail layer and pauses the slice", async () => {
    const { campaign } = await makeCampaign();
    await addInsights(campaign.id, [
      { date: "2026-06-09", spend: 400, conversions: 5 },
      { date: "2026-06-10", spend: 450, conversions: 4 },
    ]);
    const rule = await repos.automationRules.create({
      name: "Stop heavy spenders",
      metric: "spend",
      windowDays: 3,
      comparator: "gt",
      threshold: "800.0000",
      action: "pause",
    });

    const report = await runCustomRulesOnce({ repos, adapters }, { now: NOW });
    expect(report.fired).toContain(`${rule.id}:${campaign.id}`);
    expect((await repos.campaigns.get(campaign.id))?.status).toBe("paused");

    const decision = (await repos.decisions.list({ actionType: "custom_rule" }))[0];
    expect(decision?.rationale).toContain("Stop heavy spenders");
    expect(decision?.guardrailStatus).toBe("passed");
    expect(decision?.executed).toBe(true);
    expect((await repos.automationRules.list())[0]?.lastFiredAt).not.toBeNull();
  });

  it("cooldown prevents an immediate refire; fires again after it lapses", async () => {
    const { campaign } = await makeCampaign();
    await addInsights(campaign.id, [{ date: "2026-06-10", spend: 900, conversions: 1 }]);
    await repos.automationRules.create({
      name: "Cooldown rule",
      metric: "spend",
      windowDays: 1,
      comparator: "gt",
      threshold: "500.0000",
      action: "notify",
    });
    const first = await runCustomRulesOnce({ repos, adapters }, { now: NOW });
    expect(first.notified.length).toBe(1);
    const again = await runCustomRulesOnce(
      { repos, adapters },
      { now: new Date(NOW.getTime() + 60_000) },
    );
    expect(again.notified.length).toBe(0); // within cooldown
    const later = await runCustomRulesOnce(
      { repos, adapters },
      { now: new Date(NOW.getTime() + 25 * 3_600_000) },
    );
    expect(later.notified.length).toBe(1); // cooldown lapsed (insights window still matches)
  });

  it("a resume rule brings a paused slice back when results clear the bar", async () => {
    const { campaign } = await makeCampaign({ status: "paused" });
    await addInsights(campaign.id, [{ date: "2026-06-10", spend: 100, conversions: 30 }]);
    await repos.automationRules.create({
      name: "Back to work",
      metric: "results",
      windowDays: 1,
      comparator: "gt",
      threshold: "20.0000",
      action: "resume",
    });
    const report = await runCustomRulesOnce({ repos, adapters }, { now: NOW });
    expect(report.fired.length).toBe(1);
    expect((await repos.campaigns.get(campaign.id))?.status).toBe("learning");
  });

  it("notify raises attention + queues a deduped email", async () => {
    const { campaign, productId } = await makeCampaign({ title: "Notify P" });
    await addInsights(campaign.id, [{ date: "2026-06-10", spend: 200, conversions: 1 }]);
    const rule = await repos.automationRules.create({
      name: "Watchful eye",
      metric: "cost_per_result",
      windowDays: 1,
      comparator: "gt",
      threshold: "50.0000",
      action: "notify",
    });
    const report = await runCustomRulesOnce({ repos, adapters }, { now: NOW });
    expect(report.notified).toContain(`${rule.id}:${campaign.id}`);
    const attention = await repos.attention.listOpen();
    expect(attention.some((a) => a.kind === "custom_rule" && a.message.includes("Watchful eye"))).toBe(true);
    const pending = await repos.notifications.listPending();
    expect(pending.some((n) => n.kind === "custom_rule" && n.subject.includes("Watchful eye"))).toBe(true);
    // No platform mutation happened; the slice still runs.
    expect((await repos.campaigns.get(campaign.id))?.status).toBe("learning");
    expect(productId).toBeTruthy();
  });

  it("product scope only touches that product's slice", async () => {
    const a = await makeCampaign({ title: "Scoped A" });
    const b = await makeCampaign({ title: "Scoped B" });
    for (const c of [a, b]) {
      await addInsights(c.campaign.id, [{ date: "2026-06-10", spend: 900, conversions: 1 }]);
    }
    await repos.automationRules.create({
      name: "Only A",
      scope: "product",
      productId: a.productId,
      metric: "spend",
      windowDays: 1,
      comparator: "gt",
      threshold: "500.0000",
      action: "pause",
    });
    await runCustomRulesOnce({ repos, adapters }, { now: NOW });
    expect((await repos.campaigns.get(a.campaign.id))?.status).toBe("paused");
    expect((await repos.campaigns.get(b.campaign.id))?.status).toBe("learning");
  });

  it("kill switch halts rules entirely (incl. via the fast loop)", async () => {
    const { campaign } = await makeCampaign();
    await addInsights(campaign.id, [{ date: "2026-06-10", spend: 900, conversions: 1 }]);
    await repos.automationRules.create({
      name: "Should not fire",
      metric: "spend",
      windowDays: 1,
      comparator: "gt",
      threshold: "100.0000",
      action: "pause",
    });
    await repos.killSwitch.set(true);
    const direct = await runCustomRulesOnce({ repos, adapters }, { now: NOW });
    expect(direct.fired.length).toBe(0);
    const loop = await runFastLoopOnce({ repos, adapters }, { now: NOW });
    expect(loop.halted).toBe(true);
    expect((await repos.campaigns.get(campaign.id))?.status).toBe("learning");
  });

  it("dryRun writes the Decision unexecuted and does not mark the rule fired", async () => {
    const { campaign } = await makeCampaign();
    await addInsights(campaign.id, [{ date: "2026-06-10", spend: 900, conversions: 1 }]);
    const rule = await repos.automationRules.create({
      name: "Dry run rule",
      metric: "spend",
      windowDays: 1,
      comparator: "gt",
      threshold: "100.0000",
      action: "pause",
    });
    const report = await runCustomRulesOnce({ repos, adapters }, { now: NOW, dryRun: true });
    expect(report.fired.length).toBe(0);
    expect((await repos.campaigns.get(campaign.id))?.status).toBe("learning");
    const decision = (await repos.decisions.list({ actionType: "custom_rule" })).find((d) =>
      d.rationale.includes("Dry run rule"),
    );
    expect(decision?.executed).toBe(false);
    expect((await repos.automationRules.list()).find((r) => r.id === rule.id)?.lastFiredAt).toBeNull();
  });

  it("cost per result with zero results never fires (owned by the burn pause)", async () => {
    const { campaign, productId } = await makeCampaign();
    await addInsights(campaign.id, [{ date: "2026-06-10", spend: 300, conversions: 0 }]);
    await repos.automationRules.create({
      name: "CPA guard",
      scope: "product",
      productId,
      metric: "cost_per_result",
      windowDays: 1,
      comparator: "gt",
      threshold: "10.0000",
      action: "pause",
    });
    const report = await runCustomRulesOnce({ repos, adapters }, { now: NOW });
    expect(report.fired.length).toBe(0);
    expect((await repos.campaigns.get(campaign.id))?.status).toBe("learning");
  });
});
