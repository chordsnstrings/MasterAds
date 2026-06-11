// W2: pixel.js serving and ip/user-agent auto-enrichment on ingestion.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { closeDb, createRepos, type Db, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import { buildApp } from "../src/app.js";

let db: Db;
let repos: Repos;
let app: FastifyInstance;

beforeAll(async () => {
  db = await resetTestDb();
  repos = createRepos(db);
  await repos.siteKeys.create("pixel-shop", "pk");
  app = await buildApp({ db });
}, 30_000);

afterAll(async () => {
  await app.close();
  await closeDb(db);
});

describe("pixel.js (W2.3)", () => {
  it("serves the snippet with capture, persistence and track()", async () => {
    const res = await app.inject({ method: "GET", url: "/pixel.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("javascript");
    expect(res.body).toContain("data-site");
    expect(res.body).toContain("fbclid");
    expect(res.body).toContain("sccid");
    expect(res.body).toContain("180 * 24");
    expect(res.body).toContain("window.adEngine");
  });
});

describe("ingestion enrichment (W2.1)", () => {
  it("captures client ip/user-agent when the payload omits them, and stores consent signals", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { "x-api-key": "pk", "user-agent": "TestBrowser/1.0" },
      payload: {
        event_name: "Lead",
        event_time: Math.floor(Date.now() / 1000),
        content_id: "p1",
        event_id: "enrich-1",
        source_site: "pixel-shop",
        hashed_identifiers: {
          email_sha256: "a".repeat(64),
          first_name_sha256: "b".repeat(64),
          last_name_sha256: "c".repeat(64),
        },
        consent: { ad_user_data: true, ad_personalization: false },
      },
    });
    expect(res.statusCode).toBe(201);
    const row = await repos.conversions.get((res.json() as { id: string }).id);
    expect(row?.clientInfo.user_agent).toBe("TestBrowser/1.0");
    expect(row?.clientInfo.ip).toBeTruthy();
    expect(row?.consentSignals).toEqual({ ad_user_data: true, ad_personalization: false });
    expect(row?.hashedIdentifiers.first_name_sha256).toBe("b".repeat(64));
  });
});
