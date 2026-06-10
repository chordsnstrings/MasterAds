// Outcome scoring job (SW §11.2, GOALS G10): after the observation window,
// fill actual_outcome and scored_delta for executed Decisions — the
// decision-quality metric that drives trust in the autonomy ladder.
// Outcomes are a separate insert-only stream; Decision rows never mutate.
import type { Repos } from "@engine/db";

function avgDailyConversions(
  rows: { date: string; conversions: number }[],
  from: string,
  to: string,
): number {
  const inWindow = rows.filter((r) => r.date >= from && r.date < to);
  if (inWindow.length === 0) return 0;
  return inWindow.reduce((s, r) => s + r.conversions, 0) / inWindow.length;
}

export async function scoreDecisions(
  repos: Repos,
  opts: { observationDays?: number; now?: Date } = {},
): Promise<{ scored: number }> {
  const observationDays = opts.observationDays ?? 3;
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - observationDays * 86_400_000);
  let scored = 0;

  for (const decision of await repos.decisions.listUnscoredExecuted(cutoff)) {
    const campaignMatch = decision.targetRef.match(/^campaign:(.+)$/);
    if (!campaignMatch) {
      // Non-campaign decisions: record a qualitative completion outcome.
      await repos.decisions.insertOutcome({
        decisionId: decision.id,
        actualOutcome: "completed; no campaign-level effect to measure",
        scoredDelta: null,
      });
      scored++;
      continue;
    }
    const campaignId = campaignMatch[1]!;
    const insights = await repos.insights.byCampaign(campaignId);
    const decisionDay = decision.createdAt.toISOString().slice(0, 10);
    const beforeStart = new Date(decision.createdAt.getTime() - 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const afterEnd = new Date(decision.createdAt.getTime() + observationDays * 86_400_000)
      .toISOString()
      .slice(0, 10);

    if (decision.actionType.startsWith("pause")) {
      const spendAfter = insights
        .filter((i) => i.date > decisionDay && i.date <= afterEnd)
        .reduce((s, i) => s + Number(i.spend), 0);
      await repos.decisions.insertOutcome({
        decisionId: decision.id,
        actualOutcome:
          spendAfter === 0
            ? "spend stopped as intended"
            : `spend of ${spendAfter.toFixed(0)} still recorded after pause`,
        scoredDelta: spendAfter === 0 ? "1.0000" : "0.0000",
      });
      scored++;
      continue;
    }

    const before = avgDailyConversions(insights, beforeStart, decisionDay);
    const after = avgDailyConversions(insights, decisionDay, afterEnd);
    const delta = before > 0 ? (after - before) / before : after > 0 ? 1 : 0;
    await repos.decisions.insertOutcome({
      decisionId: decision.id,
      actualOutcome: `results/day moved ${before.toFixed(1)} → ${after.toFixed(1)} over the ${observationDays}-day window`,
      scoredDelta: Math.max(-9, Math.min(9, delta)).toFixed(4),
    });
    scored++;
  }
  return { scored };
}
