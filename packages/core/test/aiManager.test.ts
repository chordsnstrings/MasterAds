// W10: the AI manager can change budgets, pause/resume, and create rules —
// but ONLY through the guardrail layer: oversized moves are blocked, dry-run
// proposes without mutating, the kill switch halts inference and writes, and
// malformed rules are rejected by the shared schema.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createRepos, type Campaign, type Db, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import { createLlmClient, createPlatformAdapters } from "@engine/adapters";
import { runAiManagerOnce } from "../src/index.js";

let db: Db;
let repos: Repos;
let adapters: ReturnType<typeof createPlatformAdapters>;

function llmWith(plan: unknown): ReturnType<typeof createLlmClient> {
  return createLlmClient({ repos, mode: "stub", responder: () => JSON.stringify(plan) });
}

async function makeCampaign(status: Campaign["status"] = "autonomous"): Promise<{ campaign: Campaign; productId: string }> {
  const product = await repos.products.insert({
    mode: "catalog",
    title: `AI-P-${Math.random().toString(36).slice(2, 8)}`,
    images: [],
    status: "autonomous",
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
    budget: "500.0000",
    status,
    learningState: "exited",
    allocationAutonomous: true,
  });
  return { campaign, productId: product.id };
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

describe("ai manager (W10)", () => {
  it("executes an in-limits budget change through the guardrails", async () => {
    const { campaign } = await makeCampaign();
    const llm = llmWith({
      actions: [
        {
          type: "set_budget",
          campaign_id: campaign.id,
          daily_budget: 550, // +10% < 30% max step
          reason: "Strong returns on this slice; a small step up is safe.",
        },
      ],
    });
    const report = await runAiManagerOnce({ repos, llm, adapters }, { dryRun: false });
    expect(report.executed).toContain(`set_budget:${campaign.id}`);
    expect(Number((await repos.campaigns.get(campaign.id))?.budget)).toBe(550);
    const d = (await repos.decisions.list({ actionType: "ai_budget_change" }))[0];
    expect(d?.worker).toBe("ai-manager");
    expect(d?.executed).toBe(true);
  });

  it("an oversized move is blocked by the guardrails, not executed", async () => {
    const { campaign } = await makeCampaign();
    const llm = llmWith({
      actions: [
        {
          type: "set_budget",
          campaign_id: campaign.id,
          daily_budget: 5000, // 10× — far over the max step
          reason: "Go big.",
        },
      ],
    });
    const report = await runAiManagerOnce({ repos, llm, adapters }, { dryRun: false });
    expect(report.blocked).toContain(`set_budget:${campaign.id}`);
    expect(Number((await repos.campaigns.get(campaign.id))?.budget)).toBe(500);
    const blocked = (await repos.decisions.list({ actionType: "ai_budget_change" })).find(
      (d) => d.guardrailStatus === "blocked",
    );
    expect(blocked).toBeDefined();
  });

  it("pauses a product's slices and creates a valid rule; rejects a bad rule", async () => {
    const { campaign, productId } = await makeCampaign();
    const llm = llmWith({
      actions: [
        { type: "pause_product", product_id: productId, reason: "Losing money for a week." },
        {
          type: "create_rule",
          rule: {
            name: "AI: stop heavy losers",
            metric: "net_return",
            window_days: 7,
            comparator: "lt",
            threshold: 0.5,
            action: "pause",
            scope: "all",
          },
          reason: "The same loss pattern repeated twice.",
        },
        { type: "create_rule", rule: { name: "bad", metric: "clicks" }, reason: "x" },
      ],
    });
    const report = await runAiManagerOnce({ repos, llm, adapters }, { dryRun: false });
    expect(report.executed).toContain(`pause_product:${campaign.id}`);
    expect((await repos.campaigns.get(campaign.id))?.status).toBe("paused");
    expect(report.rulesCreated.length).toBe(1);
    expect(report.blocked).toContain("create_rule");
    const rules = await repos.automationRules.list();
    expect(rules.some((r) => r.name === "AI: stop heavy losers")).toBe(true);
    for (const r of rules) await repos.automationRules.delete(r.id); // cleanup
  });

  it("dry-run proposes (Decisions with executed=false) and mutates nothing", async () => {
    const { campaign } = await makeCampaign();
    const llm = llmWith({
      actions: [
        { type: "set_budget", campaign_id: campaign.id, daily_budget: 550, reason: "Step up." },
        { type: "note", text: "Everything else looks healthy." },
      ],
    });
    const report = await runAiManagerOnce({ repos, llm, adapters }, { dryRun: true });
    expect(report.executed.length).toBe(0);
    expect(report.notes).toContain("Everything else looks healthy.");
    expect(Number((await repos.campaigns.get(campaign.id))?.budget)).toBe(500);
    const proposal = (await repos.decisions.list({ actionType: "ai_budget_change" })).find(
      (d) => d.targetRef === `campaign:${campaign.id}` && !d.executed,
    );
    expect(proposal).toBeDefined();
  });

  it("kill switch halts the manager before any inference", async () => {
    await repos.killSwitch.set(true);
    let called = false;
    const llm = {
      complete: async (): Promise<{ text: string }> => {
        called = true;
        return { text: '{"actions":[]}' };
      },
    };
    const report = await runAiManagerOnce({ repos, llm, adapters }, { dryRun: false });
    expect(report.ran).toBe(false);
    expect(called).toBe(false);
  });

  it("stub responder produces a safe no-change review", async () => {
    const llm = createLlmClient({ repos, mode: "stub" });
    const report = await runAiManagerOnce({ repos, llm, adapters }, { dryRun: true });
    expect(report.ran).toBe(true);
    expect(report.executed.length).toBe(0);
    expect(report.notes.length).toBe(1);
  });
});
