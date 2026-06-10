import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { closeDb, createRepos, type Db, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import { computeCoverage } from "@engine/core";
import { buildApp } from "../src/app.js";

let db: Db;
let repos: Repos;
let app: FastifyInstance;

const HEADERS = { "x-api-key": "test-key-shop-a" };
const email = "c".repeat(64);

function purchase(eventId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_name: "Purchase",
    event_time: Math.floor(Date.now() / 1000) - 60,
    value: 250,
    currency: "AED",
    click_ids: { fbclid: "fb-123", gclid: "g-456" },
    hashed_identifiers: { email_sha256: email },
    content_id: "prod_x",
    event_id: eventId,
    source_site: "shop-a",
    ...extra,
  };
}

beforeAll(async () => {
  db = await resetTestDb();
  repos = createRepos(db);
  await repos.siteKeys.create("shop-a", "test-key-shop-a");
  app = await buildApp({ db });
}, 30_000);

afterAll(async () => {
  await app.close();
  await closeDb(db);
});

describe("POST /v1/events (GATE G2)", () => {
  it("rejects missing api key with 401 and wrong key with 403", async () => {
    const noKey = await app.inject({ method: "POST", url: "/v1/events", payload: purchase("a1") });
    expect(noKey.statusCode).toBe(401);
    const wrongKey = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { "x-api-key": "nope" },
      payload: purchase("a1"),
    });
    expect(wrongKey.statusCode).toBe(403);
  });

  it("rejects malformed payloads with precise errors", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: HEADERS,
      payload: { event_name: "Purchase", source_site: "shop-a" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { issues: { path: string; message: string }[] };
    const paths = body.issues.map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(["event_time", "content_id", "event_id"]));
  });

  it("persists a valid event and normalizes the event name", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: HEADERS,
      payload: purchase("p-1", { event_name: "CompletePayment" }),
    });
    expect(res.statusCode).toBe(201);
    const { id } = res.json() as { id: string };
    const row = await repos.conversions.get(id);
    expect(row?.eventName).toBe("Purchase");
    expect(row?.dedupKey).toBe("shop-a:p-1");
  });

  it("is idempotent on (source_site, event_id): replay returns 200, no duplicate row", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: HEADERS,
      payload: purchase("p-2"),
    });
    expect(first.statusCode).toBe(201);
    const replay = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: HEADERS,
      payload: purchase("p-2"),
    });
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { duplicate: boolean }).duplicate).toBe(true);
    expect((replay.json() as { id: string }).id).toBe((first.json() as { id: string }).id);
  });

  it("keeps occurred (event_time) and received_at for late events", async () => {
    const lateOccurred = Math.floor(Date.now() / 1000) - 14 * 86400;
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: HEADERS,
      payload: purchase("p-late", { event_time: lateOccurred }),
    });
    expect(res.statusCode).toBe(201);
    const row = await repos.conversions.get((res.json() as { id: string }).id);
    expect(row?.eventTime.getTime()).toBe(lateOccurred * 1000);
    expect(row!.receivedAt.getTime()).toBeGreaterThan(row!.eventTime.getTime());
  });

  it("reconciles the same conversion claimed via three platform paths to one canonical row", async () => {
    await repos.siteKeys.create("shop-a-meta", "k1");
    await repos.siteKeys.create("shop-a-google", "k2");
    await repos.siteKeys.create("shop-a-tiktok", "k3");
    const claims = [
      { site: "shop-a-meta", key: "k1", clickIds: { fbclid: "fb-1" } },
      { site: "shop-a-google", key: "k2", clickIds: { gclid: "g-1" } },
      { site: "shop-a-tiktok", key: "k3", clickIds: { ttclid: "tt-1" } },
    ];
    const ids: string[] = [];
    for (const c of claims) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/events",
        headers: { "x-api-key": c.key },
        payload: purchase("triple-1", { source_site: c.site, click_ids: c.clickIds }),
      });
      expect(res.statusCode).toBe(201);
      ids.push((res.json() as { id: string }).id);
    }
    const rows = await repos.conversions.byReconciliationKey(`Purchase:triple-1:${email}`);
    expect(rows.length).toBe(3);
    expect(rows.filter((r) => r.canonical).length).toBe(1);
  });
});

describe("click-ID coverage (GATE G2)", () => {
  it("computes coverage per site and platform on fixtures", async () => {
    // 4 canonical events on site cov-shop: 2 with fbclid, 1 with gclid, 0 ttclid.
    await repos.siteKeys.create("cov-shop", "ck");
    const fixtures = [
      { event_id: "c1", click_ids: { fbclid: "f1" } },
      { event_id: "c2", click_ids: { fbclid: "f2" } },
      { event_id: "c3", click_ids: { gclid: "g1" } },
      { event_id: "c4", click_ids: {} },
    ];
    for (const f of fixtures) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/events",
        headers: { "x-api-key": "ck" },
        payload: purchase(f.event_id, {
          source_site: "cov-shop",
          click_ids: f.click_ids,
          hashed_identifiers: { email_sha256: `${f.event_id[1]}`.repeat(64) },
        }),
      });
      expect(res.statusCode).toBe(201);
    }
    const since = new Date(Date.now() - 86_400_000);
    const events = (await repos.conversions.listCanonicalSince(since)).filter(
      (e) => e.sourceSite === "cov-shop",
    );
    const rows = computeCoverage(events);
    const meta = rows.find((r) => r.platform === "meta");
    const google = rows.find((r) => r.platform === "google");
    const tiktok = rows.find((r) => r.platform === "tiktok");
    expect(meta?.coveragePct).toBe(50);
    expect(google?.coveragePct).toBe(25);
    expect(tiktok?.coveragePct).toBe(0);
  });

  it("exposes coverage via the internal endpoint and persists snapshots", async () => {
    const res = await app.inject({ method: "GET", url: "/internal/coverage?days=7" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { coverage: { sourceSite: string; platform: string }[] };
    expect(body.coverage.length).toBeGreaterThan(0);
    const latest = await app.inject({ method: "GET", url: "/internal/coverage/latest" });
    expect(
      (latest.json() as { coverage: unknown[] }).coverage.length,
    ).toBeGreaterThan(0);
  });
});
