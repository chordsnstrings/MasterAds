// GATE G5: fixture products classify to expected specs (snapshots);
// low-confidence triggers disambiguation; restricted is blocked until sign-off.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createRepos, type Db, type Product, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import { createLlmClient } from "@engine/adapters";
import {
  buildSpecForProduct,
  checkLaunchGate,
  classifyProduct,
  seedPlaybooks,
} from "../src/index.js";

let db: Db;
let repos: Repos;
let llm: ReturnType<typeof createLlmClient>;

async function fixtureProduct(p: Partial<Product> & { title: string }): Promise<Product> {
  return repos.products.insert({
    mode: p.mode ?? "offer",
    title: p.title,
    description: p.description ?? null,
    price: p.price ?? null,
    currency: p.currency ?? "AED",
    rawInput: p.rawInput ?? null,
    url: p.url ?? null,
    images: [],
  });
}

beforeAll(async () => {
  db = await resetTestDb();
  repos = createRepos(db);
  llm = createLlmClient({ repos, mode: "stub" });
  await seedPlaybooks(repos);
}, 30_000);

afterAll(async () => {
  await closeDb(db);
});

describe("classification (stub mode, GATE G5)", () => {
  it("classifies an e-commerce product to the expected spec (snapshot)", async () => {
    const product = await fixtureProduct({
      mode: "catalog",
      title: "Three-seater Linen Sofa",
      description: "A modular three-seater sofa in washed linen, free delivery.",
      price: "2400.0000",
      url: "https://demo.example/sofa",
    });
    const result = await classifyProduct(llm, product);
    expect(result.kind).toBe("classified");
    if (result.kind !== "classified") return;
    expect(result.classification).toMatchInlineSnapshot(`
      {
        "businessModel": "ecommerce",
        "confidence": 0.92,
        "creativeAngle": "lifestyle",
        "expectedWeeklyTerminalVolume": 12,
        "funnelStages": [
          "ViewContent",
          "AddToCart",
          "InitiateCheckout",
          "Purchase",
        ],
        "policyCategory": "standard",
        "priceTier": "high",
        "terminalEvent": "Purchase",
        "vertical": "ecommerce_physical_goods",
      }
    `);

    const spec = await buildSpecForProduct(repos, product, result.classification);
    // 12/wk purchases is thin → falls back to InitiateCheckout (~36)… still
    // below 50 → AddToCart (~84) clears.
    expect(spec.optimizationEvent).toBe("AddToCart");
    expect(spec.policyCategory).toBe("standard");
    expect(Number(spec.dailyBudget)).toBe(500);
    expect(spec.targetPlatforms).toEqual(["meta", "tiktok", "google"]);
  });

  it("classifies a service offer to lead-gen (snapshot)", async () => {
    const product = await fixtureProduct({
      title: "EV charger installation",
      description: "We install EV chargers at home in Dubai, certified electricians.",
      price: "1800.0000",
      rawInput: "We install EV chargers at home in Dubai, certified electricians",
    });
    const result = await classifyProduct(llm, product);
    if (result.kind !== "classified") throw new Error("expected classified");
    expect(result.classification.vertical).toBe("local_services_leadgen");
    expect(result.classification.businessModel).toBe("lead_generation");
    expect(result.classification.terminalEvent).toBe("Lead");
    const spec = await buildSpecForProduct(repos, product, result.classification);
    expect(spec.optimizationEvent).toBe("ViewContent"); // 15/wk leads → fallback
    expect(spec.audienceStrategy).toBe("local_radius");
  });

  it("classifies property and finance verticals", async () => {
    const villa = await fixtureProduct({
      title: "Villa lease in Jumeirah",
      description: "4-bedroom villa for lease, book a viewing this week.",
    });
    const villaResult = await classifyProduct(llm, villa);
    if (villaResult.kind !== "classified") throw new Error("expected classified");
    expect(villaResult.classification.vertical).toBe("property_leadgen");

    const loan = await fixtureProduct({
      title: "Personal loans fast approval",
      description: "Personal loan offers with same-day approval and low rates.",
    });
    const loanResult = await classifyProduct(llm, loan);
    if (loanResult.kind !== "classified") throw new Error("expected classified");
    expect(loanResult.classification.vertical).toBe("restricted_finance");
    expect(loanResult.classification.policyCategory).toBe("restricted");
  });

  it("low-confidence fixture triggers the single disambiguation question", async () => {
    const vague = await fixtureProduct({ title: "Bloom", description: "Bloom things" });
    const result = await classifyProduct(llm, vague);
    expect(result.kind).toBe("needs_disambiguation");
    if (result.kind !== "needs_disambiguation") return;
    expect(result.question).toBe("Is this closer to selling a product, or offering a service?");

    // One tap later: the answer flows back as a hint and classification proceeds.
    const answered = await classifyProduct(llm, vague, { disambiguation: "service" });
    expect(answered.kind).toBe("classified");
    if (answered.kind !== "classified") return;
    expect(answered.classification.businessModel).toBe("lead_generation");
  });

  it("every classification emits an ai_inference CostEvent (invariant 4)", async () => {
    const before = (await repos.costs.list({ costType: "ai_inference" })).length;
    const p = await fixtureProduct({ title: "Ceramic mugs", description: "Handmade ceramic mugs" });
    await classifyProduct(llm, p);
    const after = await repos.costs.list({ costType: "ai_inference" });
    expect(after.length).toBe(before + 1);
    expect(after[0]?.operation).toBe("classification");
    expect(Number(after[0]?.amount)).toBeGreaterThan(0);
  });
});

describe("restricted gate (GATE G5, invariant 9)", () => {
  it("a restricted product is blocked from launch until the sign-off flag is set", async () => {
    const loan = await fixtureProduct({
      title: "Quick credit cards",
      description: "Credit card with instant approval and cashback.",
    });
    const result = await classifyProduct(llm, loan);
    if (result.kind !== "classified") throw new Error("expected classified");
    const spec = await buildSpecForProduct(repos, loan, result.classification);
    expect(spec.policyCategory).toBe("restricted");

    const blocked = await checkLaunchGate(repos, spec);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.reason).toBe("requires_signoff");

    await repos.playbooks.signOff(spec.playbookId!, "compliance-reviewer");
    const allowed = await checkLaunchGate(repos, spec);
    expect(allowed.allowed).toBe(true);
  });

  it("standard specs pass the gate", async () => {
    const spec = (await repos.specs.byProduct((await repos.products.list())[0]!.id))!;
    if (spec.policyCategory === "standard") {
      expect((await checkLaunchGate(repos, spec)).allowed).toBe(true);
    }
  });
});

describe("playbook engine", () => {
  it("seeds four playbooks; restricted finance requires sign-off", async () => {
    const all = await repos.playbooks.list();
    const verticals = all.map((p) => p.vertical).sort();
    expect(verticals).toEqual([
      "ecommerce_physical_goods",
      "local_services_leadgen",
      "property_leadgen",
      "restricted_finance",
    ]);
    const finance = all.find((p) => p.vertical === "restricted_finance");
    expect(finance?.requiresSignoff).toBe(true);
    expect(finance?.complianceConstraints).toContain("required_risk_disclaimer");
  });
});
