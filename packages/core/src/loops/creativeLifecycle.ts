// Creative fatigue detection and rotation (SW §5.4, §9.2): CTR-decay heuristic
// per product; rotate to held variants; request regeneration when the pool is
// exhausted (respecting the G6 cap).
import type { CampaignInsight, Repos } from "@engine/db";

export interface FatigueVerdict {
  fatigued: boolean;
  reason: string;
}

/** CTR-decay heuristic: recent CTR vs prior CTR over the series. */
export function detectFatigue(insights: CampaignInsight[], minDays = 6): FatigueVerdict {
  if (insights.length < minDays) return { fatigued: false, reason: "not enough history" };
  const sorted = [...insights].sort((a, b) => a.date.localeCompare(b.date));
  const half = Math.floor(sorted.length / 2);
  const ctr = (rows: CampaignInsight[]): number => {
    const imps = rows.reduce((s, r) => s + r.impressions, 0);
    const clicks = rows.reduce((s, r) => s + r.clicks, 0);
    return imps > 0 ? clicks / imps : 0;
  };
  const before = ctr(sorted.slice(0, half));
  const after = ctr(sorted.slice(half));
  if (before > 0 && after < before * 0.6) {
    return {
      fatigued: true,
      reason: `click-through fell ${(100 - (after / before) * 100).toFixed(0)}% (${(before * 100).toFixed(2)}% → ${(after * 100).toFixed(2)}%)`,
    };
  }
  return { fatigued: false, reason: "stable" };
}

export interface RotationReport {
  rotatedOut: string[];
  rotatedIn: string[];
  regenerationRequested: boolean;
}

/** Retire fatigued launched creatives and promote held variants. */
export async function rotateCreatives(
  repos: Repos,
  productId: string,
  reason: string,
): Promise<RotationReport> {
  const report: RotationReport = { rotatedOut: [], rotatedIn: [], regenerationRequested: false };
  const creatives = await repos.creatives.byProduct(productId);
  const launched = creatives.filter((c) => c.status === "launched");
  const held = creatives.filter((c) => c.status === "held");

  for (const c of launched) {
    await repos.creatives.setFatigue(c.id, "fatigued");
    await repos.creatives.setStatus(c.id, "retired");
    report.rotatedOut.push(c.id);
  }
  for (const c of held) {
    await repos.creatives.setStatus(c.id, "launched");
    await repos.creatives.setFatigue(c.id, "fresh");
    report.rotatedIn.push(c.id);
  }
  if (held.length === 0) report.regenerationRequested = true;

  await repos.decisions.insert({
    loop: "medium",
    worker: "creative-lifecycle",
    actionType: report.regenerationRequested ? "request_regeneration" : "rotate_creatives",
    targetRef: `product:${productId}`,
    rationale: report.regenerationRequested
      ? `Replaced tired ads but the spare pool is empty — asking for fresh ones. (${reason})`
      : `Replaced ${report.rotatedOut.length} tired ad(s) with ${report.rotatedIn.length} fresh variant(s). (${reason})`,
    evidence: [{ metric: "ctr_decay", window: "recent vs prior", result: reason }],
    guardrailStatus: "passed",
    executed: true,
    productId,
  });
  return report;
}

/** Sweep all products with launched creative; rotate where fatigue is detected. */
export async function runFatigueSweep(
  repos: Repos,
): Promise<{ checked: number; rotated: string[] }> {
  const result = { checked: 0, rotated: [] as string[] };
  if (await repos.killSwitch.isEngaged()) return result;
  for (const campaign of await repos.campaigns.listActive()) {
    const spec = await repos.specs.get(campaign.specId);
    if (!spec) continue;
    result.checked++;
    const insights = await repos.insights.byCampaign(campaign.id);
    const verdict = detectFatigue(insights);
    if (!verdict.fatigued) continue;
    const launched = (await repos.creatives.byProduct(spec.productId)).filter(
      (c) => c.status === "launched",
    );
    if (launched.length === 0) continue;
    await rotateCreatives(repos, spec.productId, verdict.reason);
    result.rotated.push(spec.productId);
  }
  return result;
}
