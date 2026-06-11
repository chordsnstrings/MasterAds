// Signal-strength scoring (W2): EMQ-style 0–10 score from identifier richness.
// Industry practice: 8+ match keys per event → "great" match quality and
// 15–25% better CPA. The score drives the Settings "Signal strength" readout
// and the per-site improvement tips.
import type { ConversionEvent, Repos } from "@engine/db";

export interface SignalScoreBreakdown {
  score: number;
  has: string[];
  missing: string[];
}

const WEIGHTS: { key: string; weight: number; present: (e: ConversionEvent) => boolean }[] = [
  { key: "email", weight: 2.5, present: (e) => Boolean(e.hashedIdentifiers.email_sha256) },
  { key: "phone", weight: 2, present: (e) => Boolean(e.hashedIdentifiers.phone_sha256) },
  {
    key: "click_id",
    weight: 2.5,
    present: (e) => Object.values(e.clickIds).some((v) => Boolean(v)),
  },
  {
    key: "external_id",
    weight: 1,
    present: (e) => Boolean(e.hashedIdentifiers.external_id_sha256),
  },
  {
    key: "name",
    weight: 0.5,
    present: (e) =>
      Boolean(e.hashedIdentifiers.first_name_sha256 && e.hashedIdentifiers.last_name_sha256),
  },
  {
    key: "location",
    weight: 0.5,
    present: (e) =>
      Boolean(
        e.hashedIdentifiers.city_sha256 ??
          e.hashedIdentifiers.zip_sha256 ??
          e.hashedIdentifiers.country_sha256,
      ),
  },
  { key: "ip", weight: 0.5, present: (e) => Boolean(e.clientInfo.ip) },
  { key: "user_agent", weight: 0.5, present: (e) => Boolean(e.clientInfo.user_agent) },
];

/** Score one event 0–10 on identifier richness. */
export function scoreEventSignal(event: ConversionEvent): SignalScoreBreakdown {
  let score = 0;
  const has: string[] = [];
  const missing: string[] = [];
  for (const w of WEIGHTS) {
    if (w.present(event)) {
      score += w.weight;
      has.push(w.key);
    } else {
      missing.push(w.key);
    }
  }
  return { score: Math.min(10, Number(score.toFixed(2))), has, missing };
}

export interface SiteSignalQuality {
  sourceSite: string;
  avgScore: number;
  eventsTotal: number;
  topMissing: string[];
}

/** Rolling per-site average over canonical events. */
export function computeSignalQuality(events: ConversionEvent[]): SiteSignalQuality[] {
  const bySite = new Map<string, ConversionEvent[]>();
  for (const e of events) {
    if (!e.canonical) continue;
    const list = bySite.get(e.sourceSite) ?? [];
    list.push(e);
    bySite.set(e.sourceSite, list);
  }
  const out: SiteSignalQuality[] = [];
  for (const [sourceSite, siteEvents] of bySite) {
    let total = 0;
    const missCounts = new Map<string, number>();
    for (const e of siteEvents) {
      const b = scoreEventSignal(e);
      total += b.score;
      for (const m of b.missing) missCounts.set(m, (missCounts.get(m) ?? 0) + 1);
    }
    const topMissing = [...missCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k);
    out.push({
      sourceSite,
      avgScore: Number((total / siteEvents.length).toFixed(2)),
      eventsTotal: siteEvents.length,
      topMissing,
    });
  }
  return out.sort((a, b) => a.sourceSite.localeCompare(b.sourceSite));
}

/** Compute over a rolling window and persist snapshots for the UI. */
export async function computeAndPersistSignalQuality(
  repos: Repos,
  windowDays = 7,
): Promise<SiteSignalQuality[]> {
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const events = await repos.conversions.listCanonicalSince(since);
  const rows = computeSignalQuality(events);
  for (const row of rows) {
    await repos.signalQuality.insert({
      sourceSite: row.sourceSite,
      avgScore: row.avgScore.toFixed(2),
      eventsTotal: row.eventsTotal,
      windowDays,
    });
  }
  return rows;
}
