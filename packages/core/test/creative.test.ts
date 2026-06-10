// GATE G6: stub-mode pipeline — one product in → ≥3 variants × 3 formats out,
// content_id stamped; banned claim blocked with readable reason; every
// generation emits CostEvents; regeneration cap triggers at the limit.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createRepos, type CampaignSpec, type Db, type Product, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import { createCreativeProvider, createLlmClient } from "@engine/adapters";
import {
  buildSpecForProduct,
  classifyProduct,
  generateCreatives,
  screenCreative,
  seedPlaybooks,
} from "../src/index.js";

let db: Db;
let repos: Repos;
let product: Product;
let spec: CampaignSpec;

beforeAll(async () => {
  db = await resetTestDb();
  repos = createRepos(db);
  await seedPlaybooks(repos);
  product = await repos.products.insert({
    mode: "catalog",
    title: "Three-seater Linen Sofa",
    description: "Modular sofa in washed linen.",
    price: "2400.0000",
    currency: "AED",
    url: "https://demo.example/sofa",
    images: [],
  });
  const llm = createLlmClient({ repos, mode: "stub" });
  const result = await classifyProduct(llm, product);
  if (result.kind !== "classified") throw new Error("expected classified");
  spec = await buildSpecForProduct(repos, product, result.classification);
}, 30_000);

afterAll(async () => {
  await closeDb(db);
});

describe("creative generation (GATE G6)", () => {
  it("one product in → ≥3 variants × 3 formats out, all stamped with content_id", async () => {
    const llm = createLlmClient({ repos, mode: "stub" });
    const provider = createCreativeProvider({ repos, mode: "stub" });
    const result = await generateCreatives({ repos, llm, provider }, product, spec);
    expect(result.kind).toBe("generated");
    if (result.kind !== "generated") return;
    expect(result.creatives.length).toBeGreaterThanOrEqual(9);
    const variantNos = new Set(result.creatives.map((c) => c.variantNo));
    expect(variantNos.size).toBeGreaterThanOrEqual(3);
    const formats = new Set(result.creatives.map((c) => c.format));
    expect([...formats].sort()).toEqual(["16:9", "1:1", "9:16"]);
    for (const c of result.creatives) {
      expect(c.contentId).toBe(product.id);
      expect(c.assetRef).toMatch(/^stub:\/\/image\//);
    }
    // Stub assets carry correct dimensions per format.
    const vertical = result.creatives.find((c) => c.format === "9:16");
    expect(vertical?.payload.width).toBe("1080");
    expect(vertical?.payload.height).toBe("1920");
    // Predictive scoring assigned to every variant.
    expect(result.creatives.every((c) => c.predictedScore !== null)).toBe(true);
  });

  it("a banned claim is blocked with a readable reason", async () => {
    const llm = createLlmClient({
      repos,
      mode: "stub",
      responder: () =>
        JSON.stringify({
          variants: [
            { headline: "Guaranteed returns on your savings", body: "Invest with zero worry." },
            { headline: "Comfort you can feel", body: "A sofa built for long evenings." },
          ],
        }),
    });
    const provider = createCreativeProvider({ repos, mode: "stub" });
    const result = await generateCreatives({ repos, llm, provider }, product, spec, {
      variantCount: 2,
    });
    expect(result.kind).toBe("generated");
    if (result.kind !== "generated") return;
    expect(result.blocked.length).toBe(1);
    expect(result.blocked[0]?.headline).toContain("Guaranteed returns");
    expect(result.blocked[0]?.violations[0]?.reason).toBe(
      "Promises of guaranteed results aren't allowed in ads.",
    );
    // Only the clean concept was rendered.
    expect(new Set(result.creatives.map((c) => c.variantNo)).size).toBe(1);
  });

  it("returns all_blocked when nothing passes screening", async () => {
    const llm = createLlmClient({
      repos,
      mode: "stub",
      responder: () =>
        JSON.stringify({
          variants: [{ headline: "Risk-free miracle cure", body: "Get rich quick today." }],
        }),
    });
    const provider = createCreativeProvider({ repos, mode: "stub" });
    const result = await generateCreatives({ repos, llm, provider }, product, spec, {
      variantCount: 1,
    });
    expect(result.kind).toBe("all_blocked");
  });

  it("every generation call emits CostEvents (ledger rows asserted)", async () => {
    const before = await repos.costs.list({ productId: product.id, costType: "ai_inference" });
    const llm = createLlmClient({ repos, mode: "stub" });
    const provider = createCreativeProvider({ repos, mode: "stub" });
    const result = await generateCreatives({ repos, llm, provider }, product, spec);
    expect(result.kind).toBe("generated");
    if (result.kind !== "generated") return;
    const after = await repos.costs.list({ productId: product.id, costType: "ai_inference" });
    const newRows = after.length - before.length;
    // 1 copy call + 1 image per creative row.
    expect(newRows).toBe(1 + result.creatives.length);
    const ops = after.slice(0, newRows).map((c) => c.operation);
    expect(ops).toContain("creative_copy");
    expect(ops).toContain("creative_image");
    for (const row of after.slice(0, newRows)) {
      expect(Number(row.amount)).toBeGreaterThan(0);
      expect(row.unitPrice).not.toBeNull();
    }
  });

  it("regeneration cap triggers at the configured limit", async () => {
    const llm = createLlmClient({ repos, mode: "stub" });
    const provider = createCreativeProvider({ repos, mode: "stub" });
    const cap = { maxVariantRowsPerPeriod: 9, periodDays: 7 };
    const fresh = await repos.products.insert({
      mode: "catalog",
      title: "Capped product",
      images: [],
    });
    const freshSpec = await repos.specs.insert({
      productId: fresh.id,
      playbookId: spec.playbookId,
      businessModel: "ecommerce",
      terminalEvent: "Purchase",
      optimizationEvent: "AddToCart",
      funnelStages: ["ViewContent", "AddToCart", "InitiateCheckout", "Purchase"],
      priceTier: "mid",
      creativeAngle: "lifestyle",
      policyCategory: "standard",
      targetPlatforms: ["meta"],
      audienceStrategy: "broad_platform_ai",
      formatMix: ["1:1", "9:16", "16:9"],
    });
    const first = await generateCreatives({ repos, llm, provider }, fresh, freshSpec, { cap });
    expect(first.kind).toBe("generated");
    const second = await generateCreatives({ repos, llm, provider }, fresh, freshSpec, { cap });
    expect(second.kind).toBe("cap_exceeded");
    if (second.kind === "cap_exceeded") {
      expect(second.message).toContain("capped");
    }
    // Cap is configurable: a bigger cap allows another batch.
    const third = await generateCreatives({ repos, llm, provider }, fresh, freshSpec, {
      cap: { maxVariantRowsPerPeriod: 36, periodDays: 7 },
    });
    expect(third.kind).toBe("generated");
  });
});

describe("policy screening unit", () => {
  it("per-platform rules apply only to their platform", () => {
    const beforeAfter = { headline: "Before and after results", body: "See the change." };
    expect(screenCreative(beforeAfter, ["google"]).passed).toBe(true);
    expect(screenCreative(beforeAfter, ["meta"]).passed).toBe(false);
    const clickHere = { headline: "Click here now", body: "Offer inside." };
    expect(screenCreative(clickHere, ["meta"]).passed).toBe(true);
    expect(screenCreative(clickHere, ["google"]).passed).toBe(false);
  });
});
