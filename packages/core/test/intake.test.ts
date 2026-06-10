// GATE G4 fixture tests.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createRepos, type Db, type Repos } from "@engine/db";
import { resetTestDb } from "@engine/db/src/testing.js";
import {
  detectInputKind,
  diffFeedRows,
  extractProductFromHtml,
  intakeFromFeed,
  intakeFromText,
  intakeFromUrl,
  persistIntakeResult,
  syncFeed,
} from "../src/index.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

let db: Db;
let repos: Repos;

beforeAll(async () => {
  db = await resetTestDb();
  repos = createRepos(db);
}, 30_000);

afterAll(async () => {
  await closeDb(db);
});

describe("input detection (FLOW §4.2)", () => {
  it("detects links vs descriptions", () => {
    expect(detectInputKind("https://shop.example/sofa")).toBe("url");
    expect(detectInputKind("www.shop.example")).toBe("url");
    expect(detectInputKind("We install EV chargers at home")).toBe("text");
  });
});

describe("URL intake (GATE G4)", () => {
  it("extracts title, images, price, description from a product page fixture", () => {
    const html = readFileSync(join(FIXTURES, "product-page.html"), "utf8");
    const result = extractProductFromHtml(html, "https://demo.example/sofa");
    expect(result.kind).toBe("product");
    if (result.kind !== "product") return;
    expect(result.product.title).toBe("Three-seater Linen Sofa");
    expect(result.product.price).toBe(2400);
    expect(result.product.currency).toBe("AED");
    expect(result.product.images).toContain("https://demo.example/img/sofa-hero.jpg");
    expect(result.product.description).toContain("washed linen");
    expect(result.product.availability).toBe("in_stock");
    expect(result.product.mode).toBe("catalog");
  });

  it("a malformed/unreachable URL yields the typed fallback, never an exception", async () => {
    const failing = async () => {
      throw new Error("ECONNREFUSED");
    };
    const result = await intakeFromUrl("https://does-not-exist.invalid/x", failing);
    expect(result.kind).toBe("unreadable");
    if (result.kind === "unreadable") {
      expect(result.suggestion).toBe("We couldn't open that link. Tell us what you sell instead.");
    }
    const non200 = await intakeFromUrl("https://x.example", async () => ({
      ok: false,
      status: 404,
      text: "",
    }));
    expect(non200.kind).toBe("unreadable");
  });
});

describe("offer text intake", () => {
  it("stores raw text for classification and derives a title", () => {
    const result = intakeFromText(
      "We install EV chargers at home in Dubai, certified electricians, from AED 1800.",
    );
    expect(result.kind).toBe("product");
    if (result.kind !== "product") return;
    expect(result.product.mode).toBe("offer");
    expect(result.product.rawInput).toContain("EV chargers");
    expect(result.product.title.length).toBeLessThanOrEqual(80);
  });
});

describe("feed intake (GATE G4)", () => {
  it("a 24-row CSV produces 24 normalized products under one catalog group", async () => {
    const csv = readFileSync(join(FIXTURES, "catalog-24.csv"));
    const result = intakeFromFeed(csv, "catalog-24.csv");
    expect(result.kind).toBe("products");
    if (result.kind !== "products") return;
    expect(result.products.length).toBe(24);
    expect(result.products[0]).toMatchObject({
      title: "Demo Product 1",
      price: 110,
      currency: "AED",
      availability: "in_stock",
      mode: "catalog",
    });

    const persisted = await persistIntakeResult(repos, result);
    expect(persisted.productIds.length).toBe(24);
    expect(persisted.catalogGroupId).toBeDefined();
    const group = await repos.products.byCatalogGroup(persisted.catalogGroupId!);
    expect(group.length).toBe(24);
  });

  it("an unreadable file yields the typed fallback", () => {
    const result = intakeFromFeed(Buffer.from("%PDF-1.4 garbage"), "products.csv");
    expect(result.kind).toBe("unreadable");
  });

  it("feed re-sync detects a price change and a stock-out and emits the right events", async () => {
    const feed = await repos.feeds.create({
      ref: `file://${join(FIXTURES, "catalog-24-updated.csv")}`,
      label: "demo feed",
      catalogGroupId: (await repos.products.list()).find((p) => p.catalogGroupId)!.catalogGroupId!,
      syncIntervalHours: 4,
    });
    const fetcher = async (ref: string) => ({
      content: readFileSync(ref.slice("file://".length)),
      filename: "catalog-24-updated.csv",
    });
    const changes = await syncFeed(repos, feed, fetcher);
    const types = changes.map((c) => c.changeType).sort();
    expect(types).toContain("price_change");
    expect(types).toContain("stock_out");

    // Updates applied to the catalog…
    const group = await repos.products.byCatalogGroup(feed.catalogGroupId);
    const p1 = group.find((p) => p.title === "Demo Product 1");
    const p2 = group.find((p) => p.title === "Demo Product 2");
    expect(Number(p1?.price)).toBe(99);
    expect(p2?.availability).toBe("out_of_stock");

    // …and typed change events persisted for G9 consumption.
    const unprocessed = await repos.productChanges.listUnprocessed();
    expect(unprocessed.some((c) => c.changeType === "price_change" && c.productId === p1?.id)).toBe(
      true,
    );
    expect(unprocessed.some((c) => c.changeType === "stock_out" && c.productId === p2?.id)).toBe(
      true,
    );
  });

  it("pure diff handles back-in-stock", () => {
    const existing = [
      {
        id: "prod_a",
        title: "Demo Product 2",
        price: "120.0000",
        availability: "out_of_stock",
        sourceRef: "f",
        url: "https://demo.example/p/2",
      },
    ];
    const fresh = [
      {
        mode: "catalog" as const,
        title: "Demo Product 2",
        price: 120,
        images: [],
        availability: "in_stock" as const,
        sourceRef: "f",
        url: "https://demo.example/p/2",
      },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const changes = diffFeedRows(existing as any, fresh);
    expect(changes.map((c) => c.changeType)).toContain("back_in_stock");
  });
});

describe("intake jobs API surface", () => {
  it("intake job lifecycle: reading → done", async () => {
    const job = await repos.intakeJobs.create("text", "Handmade ceramic mugs, AED 80 each");
    expect(job.status).toBe("reading");
    const { runIntakeJob } = await import("../src/intake/persist.js");
    await runIntakeJob(repos, job.id);
    const done = await repos.intakeJobs.get(job.id);
    expect(done?.status).toBe("done");
    expect((done?.result as { productIds: string[] }).productIds.length).toBe(1);
  });
});
