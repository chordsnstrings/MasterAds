// Full-system e2e in stub mode (GATE G13): seed → add product (API) →
// classify → generate → launch → inject conversion events → relay → insights
// ingest → fast loop acts → medium loop reallocates (dry-run) → UI reflects
// all of it. Plus load sanity: an ingestion burst absorbed without loss.
// One command: pnpm e2e:full.
import assert from "node:assert/strict";
import PgBoss from "pg-boss";
import { buildApp } from "@engine/api/src/app.js";
import { createPlatformAdapters, createRelays } from "@engine/adapters";
import { resetAndSeed, runFastLoopOnce, runMediumLoopOnce } from "@engine/core";
import { closeDb, createDb, createRepos } from "@engine/db";
import { runInsightsPull } from "../../scheduler/src/jobs/insights.js";
import { startRelayWorker } from "./relay-worker.js";

const DB_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/adengine_e2e";
const LOAD_SECONDS = Number(process.env.LOAD_SECONDS ?? 60);
const LOAD_RPS = Number(process.env.LOAD_RPS ?? 100);

function log(step: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), e2e: step, ...extra }));
}

async function waitFor(cond: () => Promise<boolean>, what: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for: ${what}`);
}

process.env.DATABASE_URL = DB_URL;

log("reset + seed (fresh-Postgres migrations from zero)");
await resetAndSeed(DB_URL);

const db = createDb(DB_URL);
const repos = createRepos(db);
const boss = new PgBoss(DB_URL);
await boss.start();
await startRelayWorker(boss, repos, createRelays({ mode: "stub" }), {
  pollingIntervalSeconds: 0.5,
});
const adapters = createPlatformAdapters({ repos, mode: "stub" });
const app = await buildApp({ db, jobs: boss });
const PORT = 3107;
await app.listen({ port: PORT, host: "127.0.0.1" });
const base = `http://127.0.0.1:${PORT}`;

async function post<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${base}${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 201 && res.status !== 202) {
    throw new Error(`POST ${url} → ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}
async function get<T>(url: string): Promise<T> {
  const res = await fetch(`${base}${url}`);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return (await res.json()) as T;
}

try {
  // ---- 1. Add product via the API (describe-it path) -------------------------
  log("intake");
  const intake = await post<{ intakeId: string }>("/v1/intake", {
    input: "Handmade ceramic dinner sets, AED 320 per set, free delivery across the UAE.",
  });
  let productId = "";
  await waitFor(async () => {
    const s = await get<{ status: string; result: { productIds?: string[] } | null }>(
      `/v1/intake/${intake.intakeId}`,
    );
    if (s.status === "done") {
      productId = s.result?.productIds?.[0] ?? "";
      return true;
    }
    return false;
  }, "intake done");
  assert.ok(productId, "intake produced a product");

  // ---- 2. Classify + plan, 3. generate, launch -------------------------------
  log("plan + creatives + launch", { productId });
  const plan = await post<{ specId: string; policyCategory: string }>(
    `/v1/products/${productId}/plan`,
    {},
  );
  await post(`/v1/specs/${plan.specId}/creatives`, {});
  const patchRes = await fetch(`${base}/v1/specs/${plan.specId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ destination: { kind: "hosted_page", value: "hosted" } }),
  });
  assert.equal(patchRes.status, 200);
  const launch = await post<{ status: string; campaigns: { id: string; platform: string }[] }>(
    `/v1/specs/${plan.specId}/launch`,
    {},
  );
  assert.equal(launch.status, "live");
  assert.ok(launch.campaigns.length >= 2, "campaigns created on target platforms");

  // ---- 4. Inject conversion events → relay -----------------------------------
  log("inject conversions + relay");
  await repos.siteKeys.create("e2e-shop", "e2e-key");
  const eventIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await post<{ id: string }>(
      "/v1/events",
      {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000) - i * 60,
        value: 950,
        currency: "AED",
        click_ids: { fbclid: `e2e-fb-${i}`, gclid: `e2e-g-${i}`, ttclid: `e2e-tt-${i}` },
        hashed_identifiers: { email_sha256: "e".repeat(64) },
        content_id: productId,
        event_id: `e2e-purchase-${i}`,
        source_site: "e2e-shop",
      },
      { "x-api-key": "e2e-key" },
    );
    eventIds.push(r.id);
  }
  await waitFor(async () => {
    const ev = await repos.conversions.get(eventIds[0]!);
    return (ev?.relayedTo.filter((x) => x.status === "sent").length ?? 0) === 5;
  }, "relay to all five platforms");

  // ---- 4b. Lead-quality loop (W3): closed lead becomes a relayed Purchase ------
  log("lead closed-loop");
  await post(
    "/v1/events",
    {
      event_name: "Lead",
      event_time: Math.floor(Date.now() / 1000) - 600,
      click_ids: { fbclid: "e2e-lead-fb", gclid: "e2e-lead-g" },
      hashed_identifiers: { email_sha256: "f".repeat(64) },
      content_id: productId,
      event_id: "e2e-lead-1",
      source_site: "e2e-shop",
    },
    { "x-api-key": "e2e-key" },
  );
  await post(
    "/v1/leads/outcome",
    { source_site: "e2e-shop", event_id: "e2e-lead-1", status: "closed", value: 1200, currency: "AED" },
    { "x-api-key": "e2e-key" },
  );
  await waitFor(async () => {
    const closed = (await repos.conversions.listAll()).find((e) => e.eventId === "e2e-lead-1-closed");
    return (closed?.relayedTo.filter((x) => x.status === "sent").length ?? 0) >= 1;
  }, "closed lead relayed as an offline purchase");
  const closedEvent = (await repos.conversions.listAll()).find((e) => e.eventId === "e2e-lead-1-closed")!;
  assert.equal(closedEvent.eventName, "Purchase", "closed lead recorded as a purchase");
  assert.equal(closedEvent.clickIds.fbclid, "e2e-lead-fb", "closed conversion inherits the lead's click IDs");

  // ---- 5. Insights ingest (incl. a zero-conversion burner for the fast loop) --
  log("insights ingest");
  const campaigns = await repos.campaigns.bySpec(plan.specId);
  const burner = campaigns[0]!;
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const fixtures: Record<string, { date: string; spend: number; impressions: number; clicks: number; conversions: number; revenue: number; currency: string }> = {};
  for (const c of campaigns) {
    for (const date of [yesterday, today]) {
      fixtures[`${c.platformCampaignId}:${date}`] =
        c.id === burner.id
          ? { date, spend: 450, impressions: 40_000, clicks: 700, conversions: 0, revenue: 0, currency: "AED" }
          : { date, spend: 200, impressions: 25_000, clicks: 500, conversions: 8, revenue: 2_560, currency: "AED" };
    }
  }
  const fixtureAdapters = createPlatformAdapters({ repos, mode: "stub", insightsFixtures: fixtures });
  const pullY = await runInsightsPull(repos, fixtureAdapters, yesterday);
  const pullT = await runInsightsPull(repos, fixtureAdapters, today);
  assert.ok(pullY.costEvents > 0, "ad_spend CostEvents written from platform-reported spend");
  assert.ok(pullY.adRows > 0, "per-ad insights recorded for mapped ads (W12)");
  log("insights done", { pulled: pullY.pulled + pullT.pulled });

  // ---- 6. Fast loop acts (deterministic, no LLM) ------------------------------
  const fast = await runFastLoopOnce({ repos, adapters }, {});
  assert.ok(fast.paused.includes(burner.id), "fast loop paused the zero-conversion burner");
  log("fast loop acted", { paused: fast.paused, transitions: fast.transitions });

  // ---- 7. Medium loop reallocates (dry-run) -----------------------------------
  const medium = await runMediumLoopOnce({ repos, adapters }, { dryRun: true });
  assert.ok(medium.proposedMoves.length > 0, "medium loop proposed a reallocation");
  assert.equal(medium.executedMoves.length, 0, "dry-run never mutates");
  log("medium loop (dry-run)", { proposed: medium.proposedMoves });

  // ---- 8. UI reflects all of it ------------------------------------------------
  const overview = await get<{ products: { id: string }[]; kpis: { netReturn: number | null } }>(
    "/internal/overview",
  );
  assert.ok(overview.products.some((p) => p.id === productId), "overview shows the new product");
  const detail = await get<{
    funnel: { stage: string; count: number }[];
    activity: { actionType: string }[];
  }>(`/internal/products/${productId}`);
  assert.ok(
    (detail.funnel.find((f) => f.stage === "Purchase")?.count ?? 0) >= 5,
    "funnel reflects injected purchases",
  );
  const adsView = (detail as unknown as { ads: { spend7d: number | null }[] }).ads;
  assert.ok(
    adsView.some((a) => a.spend7d !== null && a.spend7d > 0),
    "per-ad measured spend reaches the ads view (W12)",
  );
  assert.ok(
    detail.activity.some((a) => a.actionType === "launch_campaign") &&
      detail.activity.some((a) => a.actionType === "pause_zero_conversion"),
    "activity narrates launch and the fast-loop pause",
  );
  const monitoring = await get<{ reconciliation: { canonical: number }; netReturn: { netReturn: number | null } }>(
    "/internal/monitoring",
  );
  assert.ok(monitoring.reconciliation.canonical >= 5, "monitoring sees canonical conversions");
  log("ui reflects pipeline", { netReturn: monitoring.netReturn.netReturn });

  // ---- 9. Load sanity: burst absorbed without loss ------------------------------
  log("load sanity", { rps: LOAD_RPS, seconds: LOAD_SECONDS });
  await repos.siteKeys.create("load-shop", "load-key");
  let sent = 0;
  let accepted = 0;
  const t0 = Date.now();
  for (let second = 0; second < LOAD_SECONDS; second++) {
    const batch: Promise<void>[] = [];
    for (let i = 0; i < LOAD_RPS; i++) {
      const n = second * LOAD_RPS + i;
      sent++;
      batch.push(
        fetch(`${base}/v1/events`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": "load-key" },
          body: JSON.stringify({
            event_name: "ViewContent",
            event_time: Math.floor(Date.now() / 1000),
            content_id: productId,
            event_id: `load-${n}`,
            source_site: "load-shop",
          }),
        }).then((res) => {
          if (res.status === 201 || res.status === 200) accepted++;
        }),
      );
    }
    await Promise.all(batch);
    const elapsed = Date.now() - t0;
    const target = (second + 1) * 1000;
    if (elapsed < target) await new Promise((r) => setTimeout(r, target - elapsed));
  }
  assert.equal(accepted, sent, "every burst event accepted");
  const persisted = (await repos.conversions.listAll()).filter(
    (e) => e.sourceSite === "load-shop",
  ).length;
  assert.equal(persisted, sent, "every burst event persisted (no loss; queue absorbs)");
  log("load sanity passed", { sent, persisted, elapsedMs: Date.now() - t0 });

  console.log("\n✅ e2e:full PASSED — full pipeline + load sanity green in stub mode\n");
} finally {
  await app.close();
  await boss.stop({ wait: false });
  await closeDb(db);
}
process.exit(0);
