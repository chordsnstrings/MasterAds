// Click-ID coverage monitoring (SW §8.7): per site and platform, the rolling
// percentage of conversion events carrying each platform's click ID.
// Falling coverage is silent attribution decay and must alert.
import type { ConversionEvent, Repos } from "@engine/db";

export type Platform = "meta" | "google" | "tiktok";
export const PLATFORMS: readonly Platform[] = ["meta", "google", "tiktok"];

export interface CoverageRow {
  sourceSite: string;
  platform: Platform;
  eventsTotal: number;
  eventsWithClickId: number;
  coveragePct: number;
}

function hasClickIdFor(e: ConversionEvent, platform: Platform): boolean {
  const c = e.clickIds;
  switch (platform) {
    case "meta":
      return Boolean(c.fbc ?? c.fbclid);
    case "google":
      return Boolean(c.gclid ?? c.gbraid ?? c.wbraid);
    case "tiktok":
      return Boolean(c.ttclid);
  }
}

/** Pure computation over canonical conversion events. */
export function computeCoverage(events: ConversionEvent[]): CoverageRow[] {
  const bySite = new Map<string, ConversionEvent[]>();
  for (const e of events) {
    if (!e.canonical) continue;
    const list = bySite.get(e.sourceSite) ?? [];
    list.push(e);
    bySite.set(e.sourceSite, list);
  }
  const rows: CoverageRow[] = [];
  for (const [sourceSite, siteEvents] of bySite) {
    for (const platform of PLATFORMS) {
      const withId = siteEvents.filter((e) => hasClickIdFor(e, platform)).length;
      rows.push({
        sourceSite,
        platform,
        eventsTotal: siteEvents.length,
        eventsWithClickId: withId,
        coveragePct: siteEvents.length === 0 ? 0 : (withId / siteEvents.length) * 100,
      });
    }
  }
  return rows.sort((a, b) =>
    `${a.sourceSite}:${a.platform}`.localeCompare(`${b.sourceSite}:${b.platform}`),
  );
}

/** Compute over a rolling window and persist snapshots for the UI. */
export async function computeAndPersistCoverage(
  repos: Repos,
  windowDays = 7,
): Promise<CoverageRow[]> {
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const events = await repos.conversions.listCanonicalSince(since);
  const rows = computeCoverage(events);
  for (const row of rows) {
    await repos.coverage.insert({
      sourceSite: row.sourceSite,
      platform: row.platform,
      coveragePct: row.coveragePct.toFixed(2),
      eventsTotal: row.eventsTotal,
      eventsWithClickId: row.eventsWithClickId,
      windowDays,
    });
  }
  return rows;
}
