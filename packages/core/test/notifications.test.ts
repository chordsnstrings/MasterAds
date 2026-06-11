// W5: operator notifications — attention alerts queue (deduped), sign-off
// confirmation (FLOW §8.6), weekly digest once per week, dispatch through the
// email adapter with sent/failed outbox states.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createRepos, newId, type Db, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import {
  dispatchNotifications,
  queueAttentionNotifications,
  queueSignoffNotification,
  queueWeeklyDigest,
} from "../src/index.js";

let db: Db;
let repos: Repos;

beforeAll(async () => {
  db = await resetTestDb();
  repos = createRepos(db);
}, 30_000);

afterAll(async () => {
  await closeDb(db);
});

describe("notifications (W5)", () => {
  it("attention items needing a person queue an email once", async () => {
    await repos.attention.raise({
      kind: "relay_failure",
      severity: "error",
      message: "Results could not be passed along after several tries.",
      fixHint: "Check the connection and replay the window.",
      targetRef: "platform:meta",
    });
    await repos.attention.raise({
      kind: "coverage_low",
      severity: "warning", // warnings do not email
      message: "Fewer visits are carrying measurement details.",
      targetRef: "site:shop-a",
    });
    const first = await queueAttentionNotifications(repos);
    expect(first.queued).toBe(1);
    const again = await queueAttentionNotifications(repos);
    expect(again.queued).toBe(0); // deduped on the attention id
    const rows = await repos.notifications.list();
    expect(rows.filter((n) => n.kind === "attention").length).toBe(1);
    expect(rows[0]?.subject).toContain("attention");
  });

  it("restricted sign-off queues the 'ads approved' email (FLOW §8.6)", async () => {
    await queueSignoffNotification(repos, { id: "pb_x", vertical: "finance" });
    await queueSignoffNotification(repos, { id: "pb_x", vertical: "finance" });
    const rows = (await repos.notifications.list()).filter((n) => n.kind === "ads_approved");
    expect(rows.length).toBe(1);
    expect(rows[0]?.subject).toBe("Your ads are approved");
  });

  it("weekly digest queues once per ISO week and skips an empty system", async () => {
    const emptyDb = await queueWeeklyDigest(repos, new Date("2026-06-11T08:00:00Z"));
    expect(emptyDb.queued).toBe(false); // no products yet

    const product = await repos.products.insert({ mode: "catalog", title: "Digest P", images: [] });
    await repos.conversions.insertIdempotent({
      eventName: "Purchase",
      eventTime: new Date("2026-06-11T08:30:00Z"),
      value: "100.0000",
      currency: "AED",
      contentId: product.id,
      eventId: "digest-1",
      sourceSite: "digest-shop",
      dedupKey: newId("dk"),
      reconciliationKey: newId("rk"),
      canonical: true,
    });
    const first = await queueWeeklyDigest(repos, new Date("2026-06-11T09:00:00Z"));
    expect(first.queued).toBe(true);
    const sameWeek = await queueWeeklyDigest(repos, new Date("2026-06-12T09:00:00Z"));
    expect(sameWeek.queued).toBe(false);
    const nextWeek = await queueWeeklyDigest(repos, new Date("2026-06-18T09:00:00Z"));
    expect(nextWeek.queued).toBe(true);
    // The digest for the week containing the purchase counts it; the
    // following week's window does not.
    const digests = (await repos.notifications.list()).filter((n) => n.kind === "weekly_digest");
    expect(digests.length).toBe(2);
    expect(digests.some((n) => n.body.includes("Results this week: 1"))).toBe(true);
  });

  it("dispatch sends pending rows and records sent/failed outbox states", async () => {
    const outbox: { to: string; subject: string }[] = [];
    const sent = await dispatchNotifications(
      repos,
      { send: async (m) => void outbox.push({ to: m.to, subject: m.subject }) },
      "owner@example.com",
    );
    expect(sent.sent).toBeGreaterThan(0);
    expect(sent.failed).toBe(0);
    expect(outbox.every((m) => m.to === "owner@example.com")).toBe(true);
    expect((await repos.notifications.listPending()).length).toBe(0);

    await repos.notifications.queue({
      kind: "attention",
      dedupKey: "test:fail",
      subject: "x",
      body: "y",
    });
    const failed = await dispatchNotifications(
      repos,
      {
        send: async () => {
          throw new Error("smtp down");
        },
      },
      "owner@example.com",
    );
    expect(failed.failed).toBe(1);
    const row = (await repos.notifications.list()).find((n) => n.dedupKey === "test:fail");
    expect(row?.status).toBe("failed");
    expect(row?.lastError).toContain("smtp down");
  });
});
