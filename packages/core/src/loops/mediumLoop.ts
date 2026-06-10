// MEDIUM LOOP (SW §9.2-9.3): daily cross-campaign budget reallocation on NET
// RETURN — revenue ÷ (ad spend + operating cost) from the CostEvent ledger
// (invariant 5) — bounded by guardrails, executed only on auto-promoted
// slices; propose-only (executed=false) on slices below threshold.
import type { Campaign, Repos } from "@engine/db";
import type { ApprovedAction, Platform, UpdateCampaignAction } from "../guardrails/approval.js";
import { getGuardrailConfig } from "../guardrails/config.js";
import { guardedExecute } from "../guardrails/execute.js";

export interface CampaignUpdater {
  updateCampaign(action: ApprovedAction<UpdateCampaignAction>): Promise<void>;
}

export interface SliceMetrics {
  campaign: Campaign;
  productId: string;
  adSpend: number;
  operatingCost: number;
  revenue: number;
  netReturn: number;
}

/** Net-return metrics per active campaign over the trailing window. */
export async function computeSliceMetrics(
  repos: Repos,
  windowDays = 7,
  now = new Date(),
): Promise<SliceMetrics[]> {
  const since = new Date(now.getTime() - windowDays * 86_400_000);
  const out: SliceMetrics[] = [];
  for (const campaign of await repos.campaigns.listActive()) {
    const spec = await repos.specs.get(campaign.specId);
    if (!spec) continue;
    const { adSpend, operatingCost } = await repos.costs.sumsByProduct(spec.productId, since);
    const conversions = (await repos.conversions.listCanonicalSince(since)).filter(
      (e) => e.contentId === spec.productId,
    );
    const revenue = conversions.reduce((s, e) => s + (e.value !== null ? Number(e.value) : 0), 0);
    const totalCost = adSpend + operatingCost;
    if (totalCost <= 0) continue;
    out.push({
      campaign,
      productId: spec.productId,
      adSpend,
      operatingCost,
      revenue,
      netReturn: revenue / totalCost,
    });
  }
  return out;
}

export interface MediumLoopReport {
  halted: boolean;
  evaluated: number;
  executedMoves: { campaignId: string; from: number; to: number }[];
  proposedMoves: { campaignId: string; from: number; to: number }[];
}

/**
 * One medium-loop run: shift budget from the lowest- to the highest-net-return
 * slice, within guardrail step limits. Slices still below the signal threshold
 * get propose-only Decisions (dry-run) — the brain never bets on thin data.
 */
export async function runMediumLoopOnce(
  deps: { repos: Repos; adapters: Partial<Record<Platform, CampaignUpdater>> },
  opts: { now?: Date; dryRun?: boolean; windowDays?: number } = {},
): Promise<MediumLoopReport> {
  const { repos, adapters } = deps;
  const now = opts.now ?? new Date();
  const report: MediumLoopReport = { halted: false, evaluated: 0, executedMoves: [], proposedMoves: [] };

  if (await repos.killSwitch.isEngaged()) {
    report.halted = true;
    return report;
  }

  const config = await getGuardrailConfig(repos);
  const metrics = await computeSliceMetrics(repos, opts.windowDays ?? 7, now);
  report.evaluated = metrics.length;
  if (metrics.length < 2) return report;

  const sorted = [...metrics].sort((a, b) => b.netReturn - a.netReturn);
  const winner = sorted[0]!;
  const loser = sorted[sorted.length - 1]!;
  // Only act on a meaningful gap.
  if (winner.netReturn <= loser.netReturn * 1.2) return report;

  const stepPct = Math.min(20, config.maxBudgetChangePct);
  const loserBudget = Number(loser.campaign.budget);
  const winnerBudget = Number(winner.campaign.budget);
  const delta = Math.round(Math.min((loserBudget * stepPct) / 100, (winnerBudget * stepPct) / 100));
  if (delta < 1) return report;

  const moves: { slice: SliceMetrics; target: number; otherRef: string }[] = [
    { slice: loser, target: loserBudget - delta, otherRef: winner.campaign.id },
    { slice: winner, target: winnerBudget + delta, otherRef: loser.campaign.id },
  ];

  for (const move of moves) {
    const { campaign } = move.slice;
    if (!campaign.platformCampaignId) continue;
    const adapter = adapters[campaign.platform];
    if (!adapter) continue;
    const current = Number(campaign.budget);
    const increase = move.target > current;
    // Propose-only when the slice hasn't been auto-promoted (SW §9.4 rule 3).
    const proposeOnly = opts.dryRun || !campaign.allocationAutonomous;

    const action: UpdateCampaignAction = {
      type: "update_campaign",
      platform: campaign.platform,
      campaignId: campaign.id,
      platformCampaignId: campaign.platformCampaignId,
      changes: { dailyBudget: move.target },
    };
    const outcome = await guardedExecute(
      repos,
      {
        loop: "medium",
        worker: "allocation",
        actionType: "budget_change",
        targetRef: `campaign:${campaign.id}`,
        rationale: increase
          ? `Moved budget toward what's converting: this slice returns ${move.slice.netReturn.toFixed(2)}× on total cost (incl. running cost), the best in the portfolio.`
          : `Moved budget away: this slice returns ${move.slice.netReturn.toFixed(2)}× on total cost, the weakest in the portfolio.`,
        evidence: [
          { metric: "net_return", window: "7d", result: `${move.slice.netReturn.toFixed(2)}×` },
          {
            metric: "total_cost",
            window: "7d",
            result: `${(move.slice.adSpend + move.slice.operatingCost).toFixed(0)} (ads ${move.slice.adSpend.toFixed(0)} + running ${move.slice.operatingCost.toFixed(2)})`,
          },
          { metric: "budget", window: "now", result: `${current.toFixed(0)} → ${move.target.toFixed(0)}` },
        ],
        predictedOutcome: increase
          ? `portfolio net return improves as ~${delta}/day shifts to the stronger slice`
          : `~${delta}/day freed with minimal revenue loss`,
        productId: move.slice.productId,
        action,
        context: { currentBudget: current },
        dryRun: proposeOnly,
      },
      (approved) => adapter.updateCampaign(approved),
    );

    if (outcome.executed) {
      await repos.campaigns.update(campaign.id, { budget: move.target.toFixed(4) });
      report.executedMoves.push({ campaignId: campaign.id, from: current, to: move.target });
    } else if (outcome.decision.guardrailStatus === "passed") {
      report.proposedMoves.push({ campaignId: campaign.id, from: current, to: move.target });
    }
  }
  return report;
}
