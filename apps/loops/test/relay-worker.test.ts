// GATE G3 end-to-end in stub mode: POST /v1/events → relayed to all platform
// adapters via pg-boss, retried on injected failure, dead-lettered after max
// attempts, replayable by command, relay status visible per event.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import PgBoss from "pg-boss";
import type { FastifyInstance } from "fastify";
import { buildApp } from "@engine/api/src/app.js";
import { createRelays, type ConversionRelay } from "@engine/adapters";
import { closeDb, createRepos, type Db, type Repos } from "@engine/db";
import { resetTestDb, testDatabaseUrl } from "@engine/db/src/testing.js";
import { handleRelayJob, replayWindow, startRelayWorker } from "../src/relay-worker.js";

let db: Db;
let repos: Repos;
let app: FastifyInstance;
let boss: PgBoss;

const email = "d".repeat(64);

function purchase(eventId: string): Record<string, unknown> {
  return {
    event_name: "Purchase",
    event_time: Math.floor(Date.now() / 1000) - 30,
    value: 99,
    currency: "AED",
    click_ids: { fbclid: "fb-1", gclid: "g-1", ttclid: "tt-1" },
    hashed_identifiers: { email_sha256: email },
    content_id: "prod_y",
    event_id: eventId,
    source_site: "relay-shop",
  };
}

async function waitFor(cond: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("condition not met in time");
}

beforeAll(async () => {
  db = await resetTestDb();
  repos = createRepos(db);
  await repos.siteKeys.create("relay-shop", "rk");
  boss = new PgBoss(testDatabaseUrl());
  await boss.start();
  await startRelayWorker(boss, repos, createRelays({ mode: "stub" }), {
    pollingIntervalSeconds: 0.5,
    retryDelaySeconds: 1,
    maxAttempts: 4,
  });
  app = await buildApp({ db, jobs: boss });
}, 40_000);

afterAll(async () => {
  await app.close();
  await boss.stop({ wait: false });
  await closeDb(db);
});

describe("relay end-to-end (GATE G3)", () => {
  it("an ingested event is relayed to all five platforms", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { "x-api-key": "rk" },
      payload: purchase("e2e-1"),
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { id: string }).id;
    await waitFor(async () => {
      const ev = await repos.conversions.get(id);
      // The hashed email is an attribution key on every platform: all 5 send.
      const sent = ev?.relayedTo.filter((r) => r.status === "sent") ?? [];
      return sent.length === 5;
    });
    const ev = await repos.conversions.get(id);
    expect(ev?.relayedTo.map((r) => r.platform).sort()).toEqual([
      "google",
      "meta",
      "pinterest",
      "snapchat",
      "tiktok",
    ]);
  }, 30_000);

  it("retries on injected failure then succeeds", async () => {
    const ingest = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { "x-api-key": "rk" },
      payload: purchase("retry-1"),
    });
    const id = (ingest.json() as { id: string }).id;
    const base = createRelays({ mode: "stub" })[0]!;
    let calls = 0;
    const flaky: ConversionRelay = {
      ...base,
      send: async (p) => {
        calls++;
        if (calls < 3) throw new Error("injected failure");
        return base.send(p);
      },
    };
    // Drive the handler directly (deterministic): two failures, then success.
    await expect(handleRelayJob(boss, repos, flaky, id)).rejects.toThrow("injected");
    await expect(handleRelayJob(boss, repos, flaky, id)).rejects.toThrow("injected");
    await handleRelayJob(boss, repos, flaky, id);
    const ev = await repos.conversions.get(id);
    const rec = ev?.relayedTo.find((r) => r.platform === "meta");
    expect(rec?.status).toBe("sent");
    expect(rec?.attempts).toBe(3);
  });

  it("dead-letters after max attempts and raises an attention record", async () => {
    const ingest = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { "x-api-key": "rk" },
      payload: purchase("dead-1"),
    });
    const id = (ingest.json() as { id: string }).id;
    const base = createRelays({ mode: "stub" })[1]!; // google
    const broken: ConversionRelay = {
      ...base,
      send: async () => {
        throw new Error("permanently down");
      },
    };
    for (let i = 0; i < 3; i++) {
      await expect(handleRelayJob(boss, repos, broken, id, { maxAttempts: 4 })).rejects.toThrow();
    }
    // 4th attempt dead-letters and consumes (no throw).
    await handleRelayJob(boss, repos, broken, id, { maxAttempts: 4 });
    const ev = await repos.conversions.get(id);
    const rec = ev?.relayedTo.find((r) => r.platform === "google");
    expect(rec?.status).toBe("dead_letter");
    expect(rec?.attempts).toBe(4);
    const attention = await repos.attention.listOpen();
    expect(attention.some((a) => a.kind === "relay_failure" && a.targetRef === "platform:google")).toBe(
      true,
    );
    // Terminal status is not re-sent by the queue path.
    await handleRelayJob(boss, repos, base, id);
    const after = await repos.conversions.get(id);
    expect(after?.relayedTo.find((r) => r.platform === "google")?.status).toBe("dead_letter");
  });

  it("replay command re-relays a time window including dead-lettered events", async () => {
    const ev = (await repos.conversions.listAll()).find((e) => e.eventId === "dead-1");
    expect(ev).toBeDefined();
    const n = await replayWindow(boss, repos, {
      from: new Date(Date.now() - 3_600_000),
      to: new Date(),
      platform: "google",
    });
    expect(n).toBeGreaterThan(0);
    await waitFor(async () => {
      const e = await repos.conversions.get(ev!.id);
      return e?.relayedTo.find((r) => r.platform === "google")?.status === "sent";
    });
  }, 30_000);

  it("kill switch parks relay jobs instead of sending", async () => {
    const ingest = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { "x-api-key": "rk" },
      payload: purchase("kill-1"),
    });
    const id = (ingest.json() as { id: string }).id;
    await repos.killSwitch.set(true);
    try {
      const meta = createRelays({ mode: "stub" })[0]!;
      await handleRelayJob(boss, repos, meta, id);
      const ev = await repos.conversions.get(id);
      // No relay record was written for meta — nothing was sent.
      expect(ev?.relayedTo.find((r) => r.platform === "meta" && r.status === "sent")).toBeUndefined();
    } finally {
      await repos.killSwitch.set(false);
    }
  });
});
