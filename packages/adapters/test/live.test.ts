// W11: live-driver seams — per-brand credential resolution precedence and
// snapshot-locked live request bodies (verified against real APIs at first
// sandbox run; the shapes are frozen here so drift is visible).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createRepos, type Db, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import { approveAction, type CreateCampaignAction } from "@engine/core";
import {
  createMetaPlatform,
  buildGoogleAssetGroupMutate,
  buildGoogleLiveMutate,
  buildMetaAdsetBody,
  buildMetaCreativeBody,
  buildMetaLiveCreateBody,
  buildTikTokLiveCreateBody,
  resolveCreds,
} from "../src/index.js";

let db: Db;
let repos: Repos;

beforeAll(async () => {
  db = await resetTestDb();
  repos = createRepos(db);
  delete process.env.TIKTOK_ACCESS_TOKEN;
  delete process.env.TIKTOK_ADVERTISER_ID;
  delete process.env.TIKTOK_PIXEL_CODE;
}, 30_000);

afterAll(async () => {
  await closeDb(db);
  delete process.env.TIKTOK_ACCESS_TOKEN;
  delete process.env.TIKTOK_ADVERTISER_ID;
});

describe("per-brand credential resolution (W11)", () => {
  it("brand connection wins over the account-wide default and env", async () => {
    const brand = await repos.brands.create({ name: "gicglobal" });
    const product = await repos.products.insert({
      mode: "offer",
      title: "Canada immigration services",
      images: [],
      brandId: brand.id,
    });
    await repos.platformConnections.upsert(
      "tiktok",
      { access_token: "default-token", advertiser_id: "default-adv" },
      "default-adv",
      null,
    );
    await repos.platformConnections.upsert(
      "tiktok",
      { access_token: "gic-token", advertiser_id: "gic-adv" },
      "gic-adv",
      brand.id,
    );
    process.env.TIKTOK_ACCESS_TOKEN = "env-token";

    const brandCreds = await resolveCreds(repos, "tiktok", { productId: product.id });
    expect(brandCreds.access_token).toBe("gic-token");
    expect(brandCreds.advertiser_id).toBe("gic-adv");

    const other = await repos.products.insert({ mode: "offer", title: "No brand", images: [] });
    const defaultCreds = await resolveCreds(repos, "tiktok", { productId: other.id });
    expect(defaultCreds.access_token).toBe("default-token");
    delete process.env.TIKTOK_ACCESS_TOKEN;
  });

  it("throws a plain-language error when nothing is connected", async () => {
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.META_AD_ACCOUNT_ID;
    await expect(resolveCreds(repos, "meta", {})).rejects.toThrow(/connect the account/i);
  });
});

describe("live request bodies (W11 snapshots)", () => {
  it("meta live create body", () => {
    expect(
      JSON.stringify(
        buildMetaLiveCreateBody({
          name: "gicglobal — meta",
          objective: "OUTCOME_LEADS",
          policyCategory: "standard",
          dailyBudget: 66.67,
        }),
      ),
    ).toMatchInlineSnapshot(`"{"name":"gicglobal — meta","objective":"OUTCOME_LEADS","status":"PAUSED","special_ad_categories":[],"daily_budget":6667}"`);
  });

  it("tiktok live create body", () => {
    expect(
      JSON.stringify(
        buildTikTokLiveCreateBody("adv-123", {
          name: "gicglobal — tiktok",
          objective: "LEAD_GENERATION",
          dailyBudget: 66.67,
        }),
      ),
    ).toMatchInlineSnapshot(`"{"advertiser_id":"adv-123","campaign_name":"gicglobal — tiktok","objective_type":"LEAD_GENERATION","budget_mode":"BUDGET_MODE_DAY","budget":66.67,"operation_status":"DISABLE"}"`);
  });

  it("google live atomic budget+campaign mutate", () => {
    expect(
      JSON.stringify(buildGoogleLiveMutate("1234567890", { name: "gicglobal — google", dailyBudget: 66.66 })),
    ).toMatchInlineSnapshot(`"{"mutateOperations":[{"campaignBudgetOperation":{"create":{"resourceName":"customers/1234567890/campaignBudgets/-1","name":"gicglobal — google — budget","amountMicros":"66660000","deliveryMethod":"STANDARD"}}},{"campaignOperation":{"create":{"name":"gicglobal — google","status":"PAUSED","advertisingChannelType":"PERFORMANCE_MAX","campaignBudget":"customers/1234567890/campaignBudgets/-1","maximizeConversions":{},"url_expansion_opt_out":false}}}]}"`);
  });
});

describe("creative delivery seam (W12)", () => {
  const action: CreateCampaignAction = {
    type: "create_campaign",
    platform: "meta",
    specId: "spec_x",
    payload: {
      name: "gic — meta",
      objective: "leads",
      optimizationEvent: "Lead",
      dailyBudget: 66,
      currency: "CAD",
      destinationUrl: "https://example.com",
      creativeIds: ["cr_a", "cr_b"],
      contentIds: ["prod_x"],
      policyCategory: "standard",
    },
  };
  const assets = [
    { creativeId: "cr_a", assetType: "image", assetRef: "stub://image/a", headline: "H", body: "B" },
    { creativeId: "cr_b", assetType: "video", assetRef: "/media/med_1", headline: "H2", body: "B2" },
  ];

  it("stub mode maps every asset to a deterministic platform ad id", async () => {
    const adapter = createMetaPlatform({ repos, mode: "stub" });
    const first = await adapter.deliverCreatives(approveAction(action, "d1"), "stub_meta_x", assets);
    const second = await adapter.deliverCreatives(approveAction(action, "d2"), "stub_meta_x", assets);
    expect(Object.keys(first.delivered).sort()).toEqual(["cr_a", "cr_b"]);
    expect(first.delivered).toEqual(second.delivered); // deterministic
    expect(first.skipped).toEqual([]);
  });

  it("stub per-ad insights split the campaign day deterministically", async () => {
    const adapter = createMetaPlatform({ repos, mode: "stub" });
    const scope = { platformCampaignId: "stub_meta_x", platformAdIds: ["ad_1", "ad_2", "ad_3"] };
    const a = await adapter.readAdInsights(scope, { date: "2026-06-10" });
    const b = await adapter.readAdInsights(scope, { date: "2026-06-10" });
    expect(a).toEqual(b);
    const campaignDay = await adapter.readInsights({ platformCampaignId: "stub_meta_x" }, { date: "2026-06-10" });
    const summed = a.reduce((s2, r) => s2 + r.spend, 0);
    expect(Math.abs(summed - campaignDay.spend)).toBeLessThan(1); // shares of the same day
    expect(new Set(a.map((r) => r.spend)).size).toBeGreaterThan(1); // ads diverge
  });

  it("live mode skips practice assets without needing credentials", async () => {
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.META_AD_ACCOUNT_ID;
    const adapter = createMetaPlatform({ repos, mode: "live" });
    const onlyStub = [assets[0]!];
    const res = await adapter.deliverCreatives(approveAction(action, "d3"), "live_meta_x", onlyStub);
    expect(res.delivered).toEqual({});
    expect(res.skipped).toEqual(["cr_a"]);
  });

  it("meta adset + creative live bodies are snapshot-locked", () => {
    expect(
      JSON.stringify(
        buildMetaAdsetBody({
          name: "gic — meta",
          platformCampaignId: "123",
          objective: "OUTCOME_LEADS",
          datasetId: "ds_1",
          optimizationEvent: "LEAD",
          countries: ["CA"],
        }),
      ),
    ).toMatchInlineSnapshot(`"{"name":"gic — meta — delivery","campaign_id":"123","status":"PAUSED","optimization_goal":"OFFSITE_CONVERSIONS","billing_event":"IMPRESSIONS","targeting":{"geo_locations":{"countries":["CA"]},"targeting_automation":{"advantage_audience":1}},"promoted_object":{"pixel_id":"ds_1","custom_event_type":"LEAD"}}"`);
    expect(
      JSON.stringify(
        buildMetaCreativeBody({
          name: "gic — meta",
          pageId: "pg_1",
          destinationUrl: "https://example.com",
          imageHashes: ["hash1"],
          videoIds: [],
          titles: ["Move to Canada"],
          bodies: ["Trusted guidance."],
        }),
      ),
    ).toMatchInlineSnapshot(`"{"name":"gic — meta — creative","object_story_spec":{"page_id":"pg_1"},"asset_feed_spec":{"images":[{"hash":"hash1"}],"videos":[],"titles":[{"text":"Move to Canada"}],"bodies":[{"text":"Trusted guidance."}],"link_urls":[{"website_url":"https://example.com"}],"ad_formats":["AUTOMATIC_FORMAT"],"call_to_action_types":["LEARN_MORE"]}}"`);
  });

  it("google asset-group mutate body is snapshot-locked", () => {
    expect(
      JSON.stringify(
        buildGoogleAssetGroupMutate("1234567890", "555", {
          name: "gic — google",
          destinationUrl: "https://example.com",
          headlines: ["Move to Canada"],
          descriptions: ["Trusted guidance."],
          businessName: "gicglobal",
          images: [{ tempId: 1, base64: "QUJD" }],
        }),
      ),
    ).toMatchInlineSnapshot(`"{"mutateOperations":[{"assetOperation":{"create":{"resourceName":"customers/1234567890/assets/-1","textAsset":{"text":"Move to Canada"}}}},{"assetOperation":{"create":{"resourceName":"customers/1234567890/assets/-2","textAsset":{"text":"Move to Canada"}}}},{"assetOperation":{"create":{"resourceName":"customers/1234567890/assets/-3","textAsset":{"text":"Trusted guidance."}}}},{"assetOperation":{"create":{"resourceName":"customers/1234567890/assets/-4","textAsset":{"text":"gicglobal"}}}},{"assetOperation":{"create":{"resourceName":"customers/1234567890/assets/-5","imageAsset":{"data":"QUJD"}}}},{"assetGroupOperation":{"create":{"resourceName":"customers/1234567890/assetGroups/-6","campaign":"customers/1234567890/campaigns/555","name":"gic — google — assets","finalUrls":["https://example.com"],"status":"PAUSED"}}},{"assetGroupAssetOperation":{"create":{"assetGroup":"customers/1234567890/assetGroups/-6","asset":"customers/1234567890/assets/-1","fieldType":"HEADLINE"}}},{"assetGroupAssetOperation":{"create":{"assetGroup":"customers/1234567890/assetGroups/-6","asset":"customers/1234567890/assets/-2","fieldType":"LONG_HEADLINE"}}},{"assetGroupAssetOperation":{"create":{"assetGroup":"customers/1234567890/assetGroups/-6","asset":"customers/1234567890/assets/-3","fieldType":"DESCRIPTION"}}},{"assetGroupAssetOperation":{"create":{"assetGroup":"customers/1234567890/assetGroups/-6","asset":"customers/1234567890/assets/-4","fieldType":"BUSINESS_NAME"}}},{"assetGroupAssetOperation":{"create":{"assetGroup":"customers/1234567890/assetGroups/-6","asset":"customers/1234567890/assets/-5","fieldType":"MARKETING_IMAGE"}}}]}"`);
  });
});
