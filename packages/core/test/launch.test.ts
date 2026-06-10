// GATE G7: stub-mode end-to-end — a product flows intake → classify → generate
// → launch, producing Campaign rows in Launching state; re-running launch is a
// no-op; restricted specs cannot launch.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createRepos, type Db, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import { createCreativeProvider, createLlmClient, createPlatformAdapters } from "@engine/adapters";
import {
  buildSpecForProduct,
  classifyProduct,
  generateCreatives,
  intakeFromText,
  launchProduct,
  persistIntakeResult,
  seedPlaybooks,
} from "../src/index.js";

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

describe("launch end-to-end (GATE G7)", () => {
  it("intake → classify → generate → launch produces Launching campaigns on all targeted platforms", async () => {
    // Intake (describe-it path).
    const intake = intakeFromText(
      "Handmade ceramic mugs, AED 80 each, ships across the UAE from our Dubai studio.",
    );
    const persisted = await persistIntakeResult(repos, intake);
    const product = (await repos.products.get(persisted.productIds[0]!))!;

    // Classify + spec.
    const llm = createLlmClient({ repos, mode: "stub" });
    const result = await classifyProduct(llm, product);
    if (result.kind !== "classified") throw new Error("expected classified");
    const spec = await repos.specs.update(
      (await buildSpecForProduct(repos, product, result.classification)).id,
      { destination: { kind: "url", value: "https://mugs.example/shop" } },
    );

    // Generate creatives.
    const provider = createCreativeProvider({ repos, mode: "stub" });
    const gen = await generateCreatives({ repos, llm, provider }, product, spec);
    expect(gen.kind).toBe("generated");

    // Launch.
    const adapters = createPlatformAdapters({ repos, mode: "stub" });
    const launch = await launchProduct({ repos, adapters }, spec.id);
    expect(launch.kind).toBe("launched");
    if (launch.kind !== "launched") return;
    expect(launch.campaigns.length).toBe(spec.targetPlatforms.length);
    for (const c of launch.campaigns) {
      expect(c.status).toBe("launching");
      expect(c.platformCampaignId).toMatch(/^stub_/);
    }

    // Decisions were written before execution, through the guardrail layer.
    const decisions = await repos.decisions.list({ actionType: "launch_campaign" });
    expect(decisions.length).toBe(spec.targetPlatforms.length);
    expect(decisions.every((d) => d.guardrailStatus === "passed" && d.executed)).toBe(true);

    // Product entered the Launching lifecycle; creatives marked launched.
    expect((await repos.products.get(product.id))?.status).toBe("launching");

    // Re-running launch is a no-op: same campaigns, no new decisions.
    const again = await launchProduct({ repos, adapters }, spec.id);
    if (again.kind !== "launched") throw new Error("expected launched");
    expect(again.campaigns.map((c) => c.id).sort()).toEqual(
      launch.campaigns.map((c) => c.id).sort(),
    );
    expect((await repos.decisions.list({ actionType: "launch_campaign" })).length).toBe(
      decisions.length,
    );
  });

  it("a budget above the per-campaign cap is blocked by the guardrail layer", async () => {
    const product = await repos.products.insert({
      mode: "offer",
      title: "Premium consulting retainer",
      description: "We provide premium service consulting.",
      images: [],
    });
    const llm = createLlmClient({ repos, mode: "stub" });
    const cls = await classifyProduct(llm, product);
    if (cls.kind !== "classified") throw new Error("expected classified");
    const spec = await buildSpecForProduct(repos, product, cls.classification, {
      dailyBudget: 99_999, // exceeds the default per-campaign cap of 1000
      destination: { kind: "url", value: "https://consult.example" },
    });
    const provider = createCreativeProvider({ repos, mode: "stub" });
    await generateCreatives({ repos, llm, provider }, product, spec);
    const adapters = createPlatformAdapters({ repos, mode: "stub" });
    const launch = await launchProduct({ repos, adapters }, spec.id);
    if (launch.kind !== "launched") throw new Error("expected launched result shape");
    expect(launch.campaigns.length).toBe(0);
    expect(launch.blockedPlatforms.length).toBeGreaterThan(0);
    expect(launch.blockedPlatforms[0]?.reasons[0]).toContain("per-campaign cap");
    const blockedDecisions = (await repos.decisions.list({ productId: product.id })).filter(
      (d) => d.guardrailStatus === "blocked",
    );
    expect(blockedDecisions.length).toBeGreaterThan(0);
    expect(blockedDecisions.every((d) => !d.executed)).toBe(true);
  });
});
