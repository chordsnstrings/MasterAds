// W3.2: self-updating playbook priors — conversions credit launched hooks;
// generation leads with the winning hook on the next run.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createRepos, newId, type Db, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import { createCreativeProvider, createLlmClient } from "@engine/adapters";
import { generateCreatives, seedPlaybooks, updatePlaybookPriors } from "../src/index.js";

let db: Db;
let repos: Repos;

beforeAll(async () => {
  db = await resetTestDb();
  repos = createRepos(db);
  await seedPlaybooks(repos);
}, 30_000);

afterAll(async () => {
  await closeDb(db);
});

describe("playbook priors (W3.2)", () => {
  it("conversions accrue to launched hook types and reorder generation", async () => {
    const playbook = (await repos.playbooks.byVertical("ecommerce_physical_goods"))!;
    const product = await repos.products.insert({
      mode: "catalog",
      title: "Priors P",
      vertical: "ecommerce_physical_goods",
      images: [],
    });
    // One launched creative per hook; only "urgency" gets conversions.
    for (const [i, hook] of ["urgency", "benefit"].entries()) {
      await repos.creatives.insert({
        productId: product.id,
        variantNo: i + 1,
        format: "1:1",
        assetType: "image",
        assetRef: `stub://image/${hook}`,
        payload: { headline: hook, hookType: hook },
        contentId: product.id,
        status: i === 0 ? "launched" : "retired", // only urgency is live
      });
    }
    for (let i = 0; i < 10; i++) {
      await repos.conversions.insertIdempotent({
        eventName: "Purchase",
        eventTime: new Date(),
        value: "100.0000",
        currency: "AED",
        contentId: product.id,
        eventId: `priors-${i}`,
        sourceSite: "p-shop",
        dedupKey: newId("dk"),
        reconciliationKey: newId("rk"),
        canonical: true,
      });
    }

    const result = await updatePlaybookPriors(repos);
    expect(result.updated).toContain("ecommerce_physical_goods");
    const updated = (await repos.playbooks.get(playbook.id))!;
    expect(updated.performancePriors["hook:urgency"]).toBe(1);
    expect(updated.performancePriors["hook:benefit"]).toBe(0);
    const decision = (await repos.decisions.list({ actionType: "update_playbook_priors" }))[0];
    expect(decision?.rationale).toContain("urgency");

    // Generation now asks for urgency first.
    const llm = createLlmClient({ repos, mode: "stub" });
    const provider = createCreativeProvider({ repos, mode: "stub" });
    const spec = await repos.specs.insert({
      productId: product.id,
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
      formatMix: ["1:1"],
    });
    const responderPrompts: string[] = [];
    const tracedLlm = {
      complete: async (req: { prompt: string }) => {
        responderPrompts.push(req.prompt);
        return llm.complete(req as Parameters<typeof llm.complete>[0]);
      },
    };
    const gen = await generateCreatives(
      { repos, llm: tracedLlm, provider },
      product,
      spec,
    );
    expect(gen.kind).toBe("generated");
    expect(responderPrompts[0]).toMatch(/hooks .*: urgency/);
    if (gen.kind !== "generated") return;
    // 6 variants × 3 formats; every asset carries its hook type.
    expect(gen.creatives.length).toBe(18);
    expect(new Set(gen.creatives.map((c) => c.payload.hookType)).size).toBe(6);
  });
});
