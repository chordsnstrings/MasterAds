// GATE G7/G8: snapshot-correct platform payloads; writes unreachable without
// guardrail approval; kill switch blocks adapter writes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createRepos, type Db, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import { approveAction, type CreateCampaignAction } from "@engine/core";
import { createPlatformAdapters } from "../src/index.js";

let db: Db;
let repos: Repos;

const action = (platform: "meta" | "google" | "tiktok"): CreateCampaignAction => ({
  type: "create_campaign",
  platform,
  specId: "spec_fixture_1",
  payload: {
    name: "Sofa range — " + platform,
    objective: "purchases",
    optimizationEvent: "AddToCart",
    dailyBudget: 500,
    currency: "AED",
    destinationUrl: "https://demo.example/sofa",
    creativeIds: ["cr_1", "cr_2"],
    contentIds: ["prod_1"],
    policyCategory: "standard",
  },
});

beforeAll(async () => {
  db = await resetTestDb();
  repos = createRepos(db);
}, 30_000);

afterAll(async () => {
  await closeDb(db);
});

describe("platform create payloads (GATE G7 snapshots)", () => {
  it("meta Advantage+ payload", () => {
    const adapters = createPlatformAdapters({ repos, mode: "stub" });
    expect(JSON.stringify(adapters.meta.buildCreatePayload(action("meta")))).toMatchInlineSnapshot(
      `"{"name":"Sofa range — meta","objective":"OUTCOME_SALES","smart_promotion_type":"AUTOMATED_SHOPPING_ADS","status":"PAUSED","special_ad_categories":[],"daily_budget":50000,"promoted_object":{"custom_event_type":"ADD_TO_CART"},"creative_asset_ids":["cr_1","cr_2"],"destination_url":"https://demo.example/sofa","content_ids":["prod_1"]}"`,
    );
  });

  it("google Performance Max payload", () => {
    const adapters = createPlatformAdapters({ repos, mode: "stub" });
    expect(
      JSON.stringify(adapters.google.buildCreatePayload(action("google"))),
    ).toMatchInlineSnapshot(
      `"{"campaign":{"name":"Sofa range — google","advertising_channel_type":"PERFORMANCE_MAX","status":"PAUSED","campaign_budget":{"amount_micros":500000000},"bidding_strategy":{"maximize_conversions":{}}},"asset_group":{"name":"Sofa range — google — assets","final_urls":["https://demo.example/sofa"],"asset_ids":["cr_1","cr_2"]},"conversion_goal":"add_to_cart"}"`,
    );
  });

  it("tiktok Smart+ payload", () => {
    const adapters = createPlatformAdapters({ repos, mode: "stub" });
    expect(
      JSON.stringify(adapters.tiktok.buildCreatePayload(action("tiktok"))),
    ).toMatchInlineSnapshot(
      `"{"campaign_name":"Sofa range — tiktok","objective_type":"PRODUCT_SALES","smart_performance_campaign":true,"operation_status":"DISABLE","budget_mode":"BUDGET_MODE_DAY","budget":500,"optimization_event":"ADD_TO_CART","creative_asset_ids":["cr_1","cr_2"],"landing_page_url":"https://demo.example/sofa","product_ids":["prod_1"]}"`,
    );
  });

  it("restricted specs carry the special ad category on meta", () => {
    const adapters = createPlatformAdapters({ repos, mode: "stub" });
    const a = action("meta");
    a.payload.policyCategory = "restricted";
    const payload = adapters.meta.buildCreatePayload(a) as { special_ad_categories: string[] };
    expect(payload.special_ad_categories).toEqual(["FINANCIAL_PRODUCTS_SERVICES"]);
  });
});

describe("mutation-path enforcement (invariants 1 & 2)", () => {
  it("an unapproved action object is rejected by construction", async () => {
    const adapters = createPlatformAdapters({ repos, mode: "stub" });
    const forged = {
      action: action("meta"),
      decisionId: "dec_forged",
      approvedAt: new Date(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(adapters.meta.createCampaign(forged as any)).rejects.toThrow(
      /not approved by the guardrail layer/,
    );
  });

  it("kill switch blocks adapter writes even with an approved action", async () => {
    const adapters = createPlatformAdapters({ repos, mode: "stub" });
    const approved = approveAction(action("tiktok"), "dec_test");
    await repos.killSwitch.set(true);
    try {
      await expect(adapters.tiktok.createCampaign(approved)).rejects.toThrow(/kill switch/);
    } finally {
      await repos.killSwitch.set(false);
    }
    const ok = await adapters.tiktok.createCampaign(approveAction(action("tiktok"), "dec_test2"));
    expect(ok.platformCampaignId).toMatch(/^stub_tiktok_/);
  });

  it("stub create is deterministic per spec (idempotent platform ids)", async () => {
    const adapters = createPlatformAdapters({ repos, mode: "stub" });
    const a = await adapters.meta.createCampaign(approveAction(action("meta"), "d1"));
    const b = await adapters.meta.createCampaign(approveAction(action("meta"), "d2"));
    expect(a.platformCampaignId).toBe(b.platformCampaignId);
  });
});
