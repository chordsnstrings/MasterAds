import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, type Db } from "../src/client.js";
import { createRepos, type Repos } from "../src/repos.js";
import { resetTestDb } from "../src/testing.js";
import { seed } from "../src/seed.js";

let db: Db;
let repos: Repos;

beforeAll(async () => {
  db = await resetTestDb();
  repos = createRepos(db);
}, 30_000);

afterAll(async () => {
  await closeDb(db);
});

describe("migrations + seed (GATE G1)", () => {
  it("migrations applied from zero and seed runs", async () => {
    await seed(db);
    const products = await repos.products.list();
    expect(products.length).toBe(3);
    const statuses = products.map((p) => p.status).sort();
    expect(statuses).toEqual(["autonomous", "draft", "learning"]);
  });

  it("seed is idempotent", async () => {
    await seed(db);
    expect((await repos.products.list()).length).toBe(3);
  });

  it("kill switch flag exists from migration zero", async () => {
    expect(await repos.killSwitch.isEngaged()).toBe(false);
    await repos.killSwitch.set(true);
    expect(await repos.killSwitch.isEngaged()).toBe(true);
    await repos.killSwitch.set(false);
  });
});

describe("repositories", () => {
  it("product round-trip and update", async () => {
    const p = await repos.products.insert({
      mode: "offer",
      title: "Test product",
      images: [],
    });
    const updated = await repos.products.update(p.id, { status: "learning" });
    expect(updated.status).toBe("learning");
  });

  it("conversion idempotency on (source_site, event_id)", async () => {
    const row = {
      eventName: "Purchase",
      eventTime: new Date(),
      contentId: "prod_demo_sofa",
      eventId: "repo-test-1",
      sourceSite: "demo-store",
      dedupKey: "demo-store:repo-test-1",
      reconciliationKey: "Purchase:repo-test-1",
    };
    const first = await repos.conversions.insertIdempotent(row);
    const replay = await repos.conversions.insertIdempotent(row);
    expect(first.duplicate).toBe(false);
    expect(replay.duplicate).toBe(true);
    expect(replay.event.id).toBe(first.event.id);
  });

  it("campaign insert is idempotent per (spec, platform)", async () => {
    const spec = await repos.specs.byProduct("prod_demo_sofa");
    expect(spec).toBeDefined();
    const a = await repos.campaigns.insertIdempotent({
      specId: spec!.id,
      platform: "tiktok",
      campaignType: "smart_plus",
      objective: "purchases",
      optimizationEvent: "Purchase",
      budget: "100.0000",
    });
    const b = await repos.campaigns.insertIdempotent({
      specId: spec!.id,
      platform: "tiktok",
      campaignType: "smart_plus",
      objective: "purchases",
      optimizationEvent: "Purchase",
      budget: "100.0000",
    });
    expect(b.id).toBe(a.id);
  });

  it("cost sums roll up by product", async () => {
    const sums = await repos.costs.sumsByProduct(
      "prod_demo_sofa",
      new Date(Date.now() - 7 * 86_400_000),
    );
    expect(sums.adSpend).toBeGreaterThan(0);
    expect(sums.operatingCost).toBeGreaterThan(0);
  });

  it("site key verify", async () => {
    expect(await repos.siteKeys.verify("demo-store", "demo-store-key")).toBe(true);
    expect(await repos.siteKeys.verify("demo-store", "wrong")).toBe(false);
  });
});

describe("insert-only enforcement (GATE G1)", () => {
  it("repository API exposes no update/delete for decisions and costs", () => {
    const decisionMethods = Object.keys(repos.decisions);
    const costMethods = Object.keys(repos.costs);
    for (const m of [...decisionMethods, ...costMethods]) {
      expect(m).not.toMatch(/update|delete|remove|set[A-Z]/);
    }
  });

  it("raw UPDATE on decisions fails by construction (DB trigger)", async () => {
    const d = await repos.decisions.insert({
      loop: "fast",
      worker: "test",
      actionType: "pause",
      targetRef: "campaign:x",
      rationale: "test",
      guardrailStatus: "passed",
      executed: false,
    });
    await expect(
      db.$pool.query("UPDATE decisions SET rationale = 'tampered' WHERE id = $1", [d.id]),
    ).rejects.toThrow(/insert-only/);
    await expect(
      db.$pool.query("DELETE FROM decisions WHERE id = $1", [d.id]),
    ).rejects.toThrow(/insert-only/);
  });

  it("raw UPDATE/DELETE on cost_events fails by construction", async () => {
    const c = await repos.costs.insert({
      costType: "ai_inference",
      operation: "narration",
      providerOrPlatform: "stub-llm",
      units: { input_tokens: 10 },
      amount: "0.000100",
      currency: "USD",
      occurredAt: new Date(),
    });
    await expect(
      db.$pool.query("UPDATE cost_events SET amount = 0 WHERE id = $1", [c.id]),
    ).rejects.toThrow(/insert-only/);
    await expect(
      db.$pool.query("DELETE FROM cost_events WHERE id = $1", [c.id]),
    ).rejects.toThrow(/insert-only/);
  });

  it("decision outcomes are separate insert-only rows", async () => {
    const d = await repos.decisions.insert({
      loop: "medium",
      worker: "allocation",
      actionType: "budget_change",
      targetRef: "campaign:y",
      rationale: "test outcome stream",
      guardrailStatus: "passed",
      executed: true,
    });
    await repos.decisions.insertOutcome({
      decisionId: d.id,
      actualOutcome: "as predicted",
      scoredDelta: "1.0000",
    });
    const outcomes = await repos.decisions.outcomesFor(d.id);
    expect(outcomes.length).toBe(1);
    await expect(
      db.$pool.query("UPDATE decision_outcomes SET actual_outcome = 'x' WHERE decision_id = $1", [
        d.id,
      ]),
    ).rejects.toThrow(/insert-only/);
  });
});
