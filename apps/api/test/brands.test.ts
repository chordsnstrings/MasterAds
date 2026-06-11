// W11: brand workspaces — create, assign a campaign, scope the overview,
// brand-scoped connections, and the launch budget split (one total across
// channels, not per channel).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { closeDb, createRepos, type Db, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import { buildApp } from "../src/app.js";

let db: Db;
let repos: Repos;
let app: FastifyInstance;
let brandId: string;
let productId: string;
let specId: string;

beforeAll(async () => {
  db = await resetTestDb();
  repos = createRepos(db);
  app = await buildApp({ db, jobs: null });
}, 30_000);

afterAll(async () => {
  await app.close();
  await closeDb(db);
});

describe("brand workspaces (W11)", () => {
  it("creates a brand and assigns a campaign to it (inheriting the look)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/internal/brands",
      payload: { name: "gicglobal", primaryColor: "#B91C1C", tone: "trusted and direct" },
    });
    expect(created.statusCode).toBe(201);
    brandId = (created.json() as { id: string }).id;

    const product = await repos.products.insert({
      mode: "offer",
      title: "Canada immigration services",
      rawInput: "Canada immigration services for skilled workers, consultations from CAD 200.",
      images: [],
    });
    productId = product.id;
    const assign = await app.inject({
      method: "POST",
      url: `/v1/products/${productId}/brand`,
      payload: { brand_id: brandId },
    });
    expect(assign.statusCode).toBe(200);
    expect((assign.json() as { brandId: string }).brandId).toBe(brandId);
    // Brand look inherited where the page didn't set its own.
    expect((assign.json() as { brandKit: Record<string, string> }).brandKit.primaryColor).toBe("#B91C1C");

    const list = await app.inject({ method: "GET", url: "/internal/brands" });
    const gic = (list.json() as { brands: { id: string; campaignCount: number }[] }).brands.find(
      (b) => b.id === brandId,
    );
    expect(gic?.campaignCount).toBe(1);
  });

  it("overview scopes to the selected brand", async () => {
    await repos.products.insert({ mode: "catalog", title: "Other brand thing", images: [] });
    const all = await app.inject({ method: "GET", url: "/internal/overview" });
    const scoped = await app.inject({ method: "GET", url: `/internal/overview?brand=${brandId}` });
    const allCount = (all.json() as { counts: { products: number } }).counts.products;
    const scopedBody = scoped.json() as { counts: { products: number }; products: { id: string }[] };
    expect(allCount).toBeGreaterThan(scopedBody.counts.products);
    expect(scopedBody.counts.products).toBe(1);
    expect(scopedBody.products[0]?.id).toBe(productId);
  });

  it("brand-scoped connection coexists with the account-wide default", async () => {
    await app.inject({
      method: "POST",
      url: "/internal/connections/tiktok",
      payload: {
        credentials: { access_token: "default-tok-0001", advertiser_id: "adv-default", pixel_code: "px-1" },
      },
    });
    const scoped = await app.inject({
      method: "POST",
      url: "/internal/connections/tiktok",
      payload: {
        brand_id: brandId,
        credentials: { access_token: "gic-tok-0002", advertiser_id: "adv-gic", pixel_code: "px-2" },
      },
    });
    expect(scoped.statusCode).toBe(200);
    expect((scoped.json() as { adAccountRef: string }).adAccountRef).toBe("adv-gic");

    const brandView = await app.inject({
      method: "GET",
      url: `/internal/connections?brand_id=${brandId}`,
    });
    const tiktok = (brandView.json() as {
      platforms: { platform: string; adAccountRef: string | null }[];
    }).platforms.find((p) => p.platform === "tiktok");
    expect(tiktok?.adAccountRef).toBe("adv-gic");

    const defaultView = await app.inject({ method: "GET", url: "/internal/connections" });
    const tiktokDefault = (defaultView.json() as {
      platforms: { platform: string; adAccountRef: string | null }[];
    }).platforms.find((p) => p.platform === "tiktok");
    expect(tiktokDefault?.adAccountRef).toBe("adv-default");
  });

  it("a $200/day campaign splits the total across its channels", async () => {
    const plan = await app.inject({
      method: "POST",
      url: `/v1/products/${productId}/plan`,
      payload: {
        disambiguation: "service",
        daily_budget: 200,
        destination: { kind: "hosted_form", value: "hosted" },
      },
    });
    expect(plan.statusCode).toBe(201);
    specId = (plan.json() as { specId: string }).specId;
    await app.inject({ method: "POST", url: `/v1/specs/${specId}/creatives` });
    const launch = await app.inject({ method: "POST", url: `/v1/specs/${specId}/launch` });
    expect(launch.statusCode).toBe(201);

    const campaigns = await repos.campaigns.bySpec(specId);
    expect(campaigns.length).toBeGreaterThanOrEqual(2);
    const total = campaigns.reduce((s, c) => s + Number(c.budget), 0);
    expect(Math.abs(total - 200)).toBeLessThanOrEqual(1); // split, not duplicated
    const per = Number(campaigns[0]!.budget);
    expect(campaigns.every((c) => Math.abs(Number(c.budget) - per) < 0.02)).toBe(true);

    // The detail page reads all channels side by side.
    const detail = await app.inject({ method: "GET", url: `/internal/products/${productId}` });
    const channels = (detail.json() as { channels: { platform: string; dailyBudget: number }[] }).channels;
    expect(channels.length).toBe(campaigns.length);
    expect(channels.every((ch) => Math.abs(ch.dailyBudget - per) < 0.02)).toBe(true);
  });
});
