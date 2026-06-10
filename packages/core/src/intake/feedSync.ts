// Feed re-sync (SW §5.1, 4-6h cadence): diff stock/price changes against the
// stored catalog and emit typed change events (consumed by G9 automations).
import type { FeedSource, Product, Repos } from "@engine/db";
import { intakeFromFeed } from "./feed.js";
import type { NormalizedProduct } from "./types.js";

export interface FeedChange {
  productId: string;
  changeType: "price_change" | "stock_out" | "back_in_stock" | "new_product";
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/** Pure diff: existing products vs freshly parsed feed rows. */
export function diffFeedRows(existing: Product[], fresh: NormalizedProduct[]): FeedChange[] {
  const changes: FeedChange[] = [];
  const byKey = new Map<string, Product>();
  for (const p of existing) {
    byKey.set(p.sourceRef && p.title ? p.title.toLowerCase() : p.id, p);
  }
  // Prefer external id matching when present.
  const byExternal = new Map<string, Product>();
  for (const p of existing) {
    if (p.url) byExternal.set(p.url, p);
  }

  for (const row of fresh) {
    const match =
      (row.url ? byExternal.get(row.url) : undefined) ?? byKey.get(row.title.toLowerCase());
    if (!match) {
      changes.push({ productId: "", changeType: "new_product", after: { title: row.title } });
      continue;
    }
    const oldPrice = match.price !== null ? Number(match.price) : undefined;
    if (row.price !== undefined && oldPrice !== undefined && row.price !== oldPrice) {
      changes.push({
        productId: match.id,
        changeType: "price_change",
        before: { price: oldPrice },
        after: { price: row.price },
      });
    }
    if (row.availability === "out_of_stock" && match.availability !== "out_of_stock") {
      changes.push({
        productId: match.id,
        changeType: "stock_out",
        before: { availability: match.availability },
        after: { availability: "out_of_stock" },
      });
    }
    if (row.availability === "in_stock" && match.availability === "out_of_stock") {
      changes.push({
        productId: match.id,
        changeType: "back_in_stock",
        before: { availability: "out_of_stock" },
        after: { availability: "in_stock" },
      });
    }
  }
  return changes;
}

export type FeedFetcher = (ref: string) => Promise<{ content: Buffer; filename: string }>;

/** Re-pull one feed, apply price/stock updates, persist typed change events. */
export async function syncFeed(
  repos: Repos,
  feed: FeedSource,
  fetchFeed: FeedFetcher,
): Promise<FeedChange[]> {
  const { content, filename } = await fetchFeed(feed.ref);
  const parsed = intakeFromFeed(content, filename);
  if (parsed.kind !== "products") {
    throw new Error(`feed ${feed.id} unreadable: ${parsed.kind === "unreadable" ? parsed.reason : "single"}`);
  }
  const existing = await repos.products.byCatalogGroup(feed.catalogGroupId);
  const changes = diffFeedRows(existing, parsed.products);

  for (const change of changes) {
    if (change.changeType === "price_change") {
      await repos.products.update(change.productId, {
        price: Number(change.after?.price).toFixed(4),
      });
    } else if (change.changeType === "stock_out") {
      await repos.products.update(change.productId, { availability: "out_of_stock" });
    } else if (change.changeType === "back_in_stock") {
      await repos.products.update(change.productId, { availability: "in_stock" });
    }
    if (change.productId) {
      await repos.productChanges.insert({
        productId: change.productId,
        changeType: change.changeType,
        before: change.before ?? null,
        after: change.after ?? null,
      });
    }
  }
  await repos.feeds.markSynced(feed.id, new Date());
  return changes;
}
