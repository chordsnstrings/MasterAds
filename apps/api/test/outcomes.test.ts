// Wave 3: lead-quality loop, measured WhatsApp redirect, margin, experiments.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { closeDb, createRepos, type Db, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import { createGoogleRelay, createMetaRelay } from "@engine/adapters";
import { buildApp } from "../src/app.js";

let db: Db;
let repos: Repos;
let app: FastifyInstance;

beforeAll(async () => {
  db = await resetTestDb();
  repos = createRepos(db);
  await repos.siteKeys.create("crm-shop", "ck");
  app = await buildApp({ db });
}, 30_000);

afterAll(async () => {
  await app.close();
  await closeDb(db);
});

describe("lead-quality loop (W3.1)", () => {
  async function injectLead(eventId: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { "x-api-key": "ck" },
      payload: {
        event_name: "Lead",
        event_time: Math.floor(Date.now() / 1000) - 3600,
        content_id: "prod_leadgen",
        event_id: eventId,
        source_site: "crm-shop",
        click_ids: { fbclid: `fb-${eventId}`, gclid: `g-${eventId}` },
        hashed_identifiers: { email_sha256: "a".repeat(64) },
      },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  }

  it("a closed lead becomes a canonical Purchase inheriting the lead's click IDs and relays", async () => {
    await injectLead("lead-1");
    const closed = await app.inject({
      method: "POST",
      url: "/v1/leads/outcome",
      headers: { "x-api-key": "ck" },
      payload: { source_site: "crm-shop", event_id: "lead-1", status: "closed", value: 5200, currency: "AED" },
    });
    expect(closed.statusCode).toBe(201);
    const { conversionId } = closed.json() as { conversionId: string };
    const conv = await repos.conversions.get(conversionId);
    expect(conv?.eventName).toBe("Purchase");
    expect(Number(conv?.value)).toBe(5200);
    expect(conv?.clickIds.fbclid).toBe("fb-lead-1"); // inherited identity
    expect(conv?.eventId).toBe("lead-1-closed");

    // The offline conversion relays with the original click IDs.
    const meta = createMetaRelay({ mode: "stub" }).buildPayload(conv!);
    expect(meta.kind).toBe("send");
    const google = createGoogleRelay({ mode: "stub" }).buildPayload(conv!);
    if (google.kind !== "send") throw new Error("expected send");
    expect((google.payload.conversions as { gclid?: string }[])[0]?.gclid).toBe("g-lead-1");

    // Replaying the outcome is idempotent.
    const replay = await app.inject({
      method: "POST",
      url: "/v1/leads/outcome",
      headers: { "x-api-key": "ck" },
      payload: { source_site: "crm-shop", event_id: "lead-1", status: "closed", value: 5200, currency: "AED" },
    });
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { duplicate: boolean }).duplicate).toBe(true);
  });

  it("disqualified leads are recorded but never relayed; closed requires value", async () => {
    await injectLead("lead-2");
    const dq = await app.inject({
      method: "POST",
      url: "/v1/leads/outcome",
      headers: { "x-api-key": "ck" },
      payload: { source_site: "crm-shop", event_id: "lead-2", status: "disqualified" },
    });
    expect(dq.statusCode).toBe(200);
    const decisions = await repos.decisions.list({ actionType: "lead_outcome" });
    expect(decisions.some((d) => d.rationale.includes("not a fit"))).toBe(true);

    const noValue = await app.inject({
      method: "POST",
      url: "/v1/leads/outcome",
      headers: { "x-api-key": "ck" },
      payload: { source_site: "crm-shop", event_id: "lead-2", status: "closed" },
    });
    expect(noValue.statusCode).toBe(400);

    const missing = await app.inject({
      method: "POST",
      url: "/v1/leads/outcome",
      headers: { "x-api-key": "ck" },
      payload: { source_site: "crm-shop", event_id: "nope", status: "qualified" },
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe("measured WhatsApp destination (W3.3)", () => {
  it("logs a Lead-intent event with landing click IDs then redirects to wa.me", async () => {
    const product = await repos.products.insert({ mode: "offer", title: "WA Service", images: [] });
    const res = await app.inject({
      method: "GET",
      url: `/hosted/wa/${product.id}?p=%2B971500000001&fbclid=wa-click-1`,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("https://wa.me/971500000001");
    const events = (await repos.conversions.listCanonicalSince(new Date(Date.now() - 60_000))).filter(
      (e) => e.contentId === product.id,
    );
    expect(events.length).toBe(1);
    expect(events[0]?.eventName).toBe("Lead"); // Contact alias → Lead
    expect(events[0]?.clickIds.fbclid).toBe("wa-click-1");
  });
});

describe("incrementality experiments (W3.5)", () => {
  it("create → complete computes lift and feeds the Overview incremental tile", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/internal/experiments",
      payload: {
        name: "Meta holdout — Dubai vs Abu Dhabi",
        platform: "meta",
        test_region: "Dubai",
        control_region: "Abu Dhabi",
        starts_at: "2026-05-01T00:00:00Z",
        ends_at: "2026-05-28T00:00:00Z",
      },
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json() as { id: string };

    const completed = await app.inject({
      method: "POST",
      url: `/internal/experiments/${id}/complete`,
      payload: { test_conversions: 150, control_conversions: 100, incremental_return: 2.3 },
    });
    expect(completed.statusCode).toBe(200);
    const exp = completed.json() as { readout: { lift_pct: number } };
    expect(exp.readout.lift_pct).toBe(50);

    const overview = await app.inject({ method: "GET", url: "/internal/overview" });
    expect((overview.json() as { kpis: { incremental: number } }).kpis.incremental).toBe(2.3);
  });
});

describe("margin-aware value (W3.4)", () => {
  it("net return uses value × margin when margin is set", async () => {
    const product = await repos.products.insert({
      mode: "catalog",
      title: "Margin P",
      images: [],
    });
    await repos.specs.insert({
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
    await repos.conversions.insertIdempotent({
      eventName: "Purchase",
      eventTime: new Date(),
      value: "1000.0000",
      currency: "AED",
      contentId: product.id,
      eventId: "margin-1",
      sourceSite: "crm-shop",
      dedupKey: "crm-shop:margin-1",
      reconciliationKey: "Purchase:margin-1:anon",
      canonical: true,
    });
    const patch = await app.inject({
      method: "PATCH",
      url: `/internal/products/${product.id}/intent`,
      payload: { margin_pct: 30 },
    });
    expect(patch.statusCode).toBe(200);
    const detail = await app.inject({ method: "GET", url: `/internal/products/${product.id}` });
    const metrics = (detail.json() as { metrics: { revenue7d: number } }).metrics;
    expect(metrics.revenue7d).toBe(300); // 1000 × 30%
  });
});
