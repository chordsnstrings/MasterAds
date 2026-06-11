// Wave 1: operator auth on /internal/*, hosted-page XSS escaping, site onboarding.
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
  app = await buildApp({ db });
}, 30_000);

afterAll(async () => {
  delete process.env.OPERATOR_TOKEN;
  await app.close();
  await closeDb(db);
});

describe("operator auth (W1.1)", () => {
  it("open when OPERATOR_TOKEN is unset; enforced when set", async () => {
    delete process.env.OPERATOR_TOKEN;
    expect((await app.inject({ method: "GET", url: "/internal/overview" })).statusCode).toBe(200);

    process.env.OPERATOR_TOKEN = "secret-operator-key";
    try {
      const denied = await app.inject({ method: "GET", url: "/internal/overview" });
      expect(denied.statusCode).toBe(401);
      const wrong = await app.inject({
        method: "GET",
        url: "/internal/overview",
        headers: { "x-operator-key": "nope" },
      });
      expect(wrong.statusCode).toBe(401);
      const ok = await app.inject({
        method: "GET",
        url: "/internal/overview",
        headers: { "x-operator-key": "secret-operator-key" },
      });
      expect(ok.statusCode).toBe(200);
      // Public surfaces unaffected: ingestion and hosted pages keep working.
      expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    } finally {
      delete process.env.OPERATOR_TOKEN;
    }
  });
});

describe("hosted page escaping (W1.2)", () => {
  it("renders hostile product fields escaped", async () => {
    const product = await repos.products.insert({
      mode: "offer",
      title: `<script>alert(1)</script>`,
      description: `"><img src=x onerror=alert(2)>`,
      images: [],
    });
    for (const path of [`/hosted/p/${product.id}`, `/hosted/f/${product.id}`]) {
      const res = await app.inject({ method: "GET", url: path });
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain("<script>alert(1)</script>");
      expect(res.body).not.toContain("onerror=alert(2)>");
      expect(res.body).toContain("&lt;script&gt;");
    }
  });
});

describe("site onboarding (W1.3)", () => {
  it("creates a site, returns the key once, and the key authenticates ingestion", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/internal/sites",
      payload: { site: "My Shop!", label: "Main storefront" },
    });
    expect(created.statusCode).toBe(201);
    const { site, key } = created.json() as { site: string; key: string };
    expect(site).toBe("my-shop-");
    expect(key).toMatch(/^sk_[a-f0-9]{48}$/);

    // Listing never exposes keys.
    const list = await app.inject({ method: "GET", url: "/internal/sites" });
    const sites = (list.json() as { sites: { sourceSite: string }[] }).sites;
    expect(sites.some((s) => s.sourceSite === site)).toBe(true);
    expect(list.body).not.toContain(key);

    // The issued key works on /v1/events.
    const event = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { "x-api-key": key },
      payload: {
        event_name: "ViewContent",
        event_time: Math.floor(Date.now() / 1000),
        content_id: "prod_x",
        event_id: "site-onboard-1",
        source_site: site,
      },
    });
    expect(event.statusCode).toBe(201);
  });
});
