// Feed re-sync job (SW §5.1): re-pull connected feeds on their 4-6h cadence.
import { readFile } from "node:fs/promises";
import { syncFeed, type FeedFetcher } from "@engine/core";
import type { Repos } from "@engine/db";

export const defaultFeedFetcher: FeedFetcher = async (ref) => {
  if (ref.startsWith("file://")) {
    const path = ref.slice("file://".length);
    return { content: await readFile(path), filename: path };
  }
  const res = await fetch(ref, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`feed fetch ${res.status}`);
  return { content: Buffer.from(await res.arrayBuffer()), filename: new URL(ref).pathname };
};

export async function runFeedSyncSweep(
  repos: Repos,
  fetchFeed: FeedFetcher = defaultFeedFetcher,
): Promise<number> {
  const due = await repos.feeds.due(new Date());
  let synced = 0;
  for (const feed of due) {
    try {
      const changes = await syncFeed(repos, feed, fetchFeed);
      synced++;
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          service: "scheduler",
          msg: "feed synced",
          feedId: feed.id,
          changes: changes.map((c) => c.changeType),
        }),
      );
    } catch (err) {
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          service: "scheduler",
          msg: "feed sync failed",
          feedId: feed.id,
          error: String(err),
        }),
      );
    }
  }
  return synced;
}
