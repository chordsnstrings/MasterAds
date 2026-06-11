// W7: platform connections through the UI — saved server-side, returned only
// masked, blank-on-update keeps stored values, ad-account linkage recorded,
// env precedence (explicit env vars always win over stored values).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { closeDb, createRepos, type Db, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import { applyStoredConnections } from "@engine/core";
import { buildApp } from "../src/app.js";

let db: Db;
let repos: Repos;
let app: FastifyInstance;

beforeAll(async () => {
  db = await resetTestDb();
  repos = createRepos(db);
  app = await buildApp({ db, jobs: null });
  delete process.env.SNAPCHAT_ACCESS_TOKEN;
  delete process.env.SNAPCHAT_AD_ACCOUNT_ID;
  delete process.env.SNAPCHAT_PIXEL_ID;
}, 30_000);

afterAll(async () => {
  await app.close();
  await closeDb(db);
  delete process.env.SNAPCHAT_ACCESS_TOKEN;
  delete process.env.SNAPCHAT_AD_ACCOUNT_ID;
  delete process.env.SNAPCHAT_PIXEL_ID;
});

describe("platform connections (W7)", () => {
  it("rejects an incomplete save with the missing field names", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/connections/snapchat",
      payload: { credentials: { access_token: "snap-secret-token-1234" } },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { missing: string[] }).missing.sort()).toEqual([
      "ad_account_id",
      "pixel_id",
    ]);
  });

  it("saves a full connection and records which ad account is linked", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/connections/snapchat",
      payload: {
        credentials: {
          access_token: "snap-secret-token-1234",
          ad_account_id: "snap-acct-9876",
          pixel_id: "snap-px-5555",
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { adAccountRef: string }).adAccountRef).toBe("snap-acct-9876");
    const acct = await repos.adAccounts.get("snapchat");
    expect(acct?.accountRef).toBe("snap-acct-9876");
    // Settings shows the linked account too.
    const settings = await app.inject({ method: "GET", url: "/internal/settings" });
    const conn = (settings.json() as { connections: { platform: string; accountRef: string | null }[] })
      .connections.find((c) => c.platform === "snapchat");
    expect(conn?.accountRef).toBe("snap-acct-9876");
  });

  it("GET returns values only masked — never the raw secret", async () => {
    const res = await app.inject({ method: "GET", url: "/internal/connections" });
    const snap = (res.json() as {
      platforms: { platform: string; fields: { key: string; savedMask: string | null }[] }[];
    }).platforms.find((p) => p.platform === "snapchat")!;
    const token = snap.fields.find((f) => f.key === "access_token")!;
    expect(token.savedMask).toBe("····1234");
    expect(JSON.stringify(res.json())).not.toContain("snap-secret-token-1234");
  });

  it("blank fields on update keep the stored values (merge semantics)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/connections/snapchat",
      payload: { credentials: { access_token: "", ad_account_id: "snap-acct-0001", pixel_id: "" } },
    });
    expect(res.statusCode).toBe(200);
    const row = await repos.platformConnections.get("snapchat");
    expect(row?.credentials.access_token).toBe("snap-secret-token-1234"); // kept
    expect(row?.credentials.ad_account_id).toBe("snap-acct-0001"); // replaced
    expect(row?.adAccountRef).toBe("snap-acct-0001");
  });

  it("boot loader exports stored values; explicit env always wins", async () => {
    delete process.env.SNAPCHAT_ACCESS_TOKEN;
    process.env.SNAPCHAT_PIXEL_ID = "env-wins";
    const { applied } = await applyStoredConnections(repos);
    expect(process.env.SNAPCHAT_ACCESS_TOKEN).toBe("snap-secret-token-1234");
    expect(process.env.SNAPCHAT_PIXEL_ID).toBe("env-wins"); // not overwritten
    expect(applied).toContain("SNAPCHAT_ACCESS_TOKEN");
    expect(applied).not.toContain("SNAPCHAT_PIXEL_ID");
  });

  it("AI provider connects through the same path (provider + key, masked, applied)", async () => {
    delete process.env.LLM_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_MODE;
    const bad = await app.inject({
      method: "POST",
      url: "/internal/connections/ai",
      payload: { credentials: { provider: "openai" } },
    });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { missing: string[] }).missing).toContain("api_key");

    const ok = await app.inject({
      method: "POST",
      url: "/internal/connections/ai",
      payload: {
        credentials: { provider: "openai", api_key: "sk-test-openai-9876", mode: "live" },
      },
    });
    expect(ok.statusCode).toBe(200);
    // Applied to the running process (env precedence rules unchanged).
    expect(process.env.LLM_PROVIDER).toBe("openai");
    expect(process.env.OPENAI_API_KEY).toBe("sk-test-openai-9876");
    expect(process.env.LLM_MODE).toBe("live");
    // Masked on read.
    const res = await app.inject({ method: "GET", url: "/internal/connections" });
    const ai = (res.json() as { ai: { provider: string; fields: { key: string; savedMask: string | null }[] } }).ai;
    expect(ai.provider).toBe("openai");
    expect(ai.fields.find((f) => f.key === "api_key")?.savedMask).toBe("····9876");
    expect(JSON.stringify(res.json())).not.toContain("sk-test-openai-9876");
    delete process.env.LLM_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_MODE;
  });

  it("unknown platform → 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/connections/myspace",
      payload: { credentials: {} },
    });
    expect(res.statusCode).toBe(404);
  });
});
