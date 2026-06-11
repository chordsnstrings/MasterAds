// W11: live-driver seams — per-brand credential resolution precedence and
// snapshot-locked live request bodies (verified against real APIs at first
// sandbox run; the shapes are frozen here so drift is visible).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createRepos, type Db, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import {
  buildGoogleLiveMutate,
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
