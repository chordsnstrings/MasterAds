// FAST LOOP (SW §9.3-9.4): deterministic code, NO LLM calls (invariant 6).
// Pacing checks, spend anomaly detection, zero-conversion burn pausing,
// circuit breakers, lifecycle transitions, and per-slice auto-promotion.
// Autonomous from the first deploy; needs no learned signal.
import { z } from "zod";
import type { Campaign, CampaignInsight, Repos } from "@engine/db";
import type { ApprovedAction, PauseResumeAction, Platform } from "../guardrails/approval.js";
import { guardedExecute } from "../guardrails/execute.js";
import { runCustomRulesOnce } from "../automations/customRules.js";
import type { Adapters } from "../automations/index.js";

export const fastLoopConfigSchema = z.object({
  /** Pause when spend ≥ multiplier × daily budget with zero conversions. */
  zeroConversionBurnMultiplier: z.number().positive().default(1.5),
  /** Window (days incl. today) for the zero-conversion check. */
  burnWindowDays: z.number().int().positive().default(2),
  /** Circuit breaker: today's spend ≥ z-score over trailing days… */
  anomalyZScore: z.number().positive().default(3),
  /** …or ≥ multiplier × daily budget (fallback when history is thin). */
  anomalySpendMultiplier: z.number().positive().default(3),
  /** Learning exits / allocation promotes at this weekly conversion volume. */
  learningExitWeeklyConversions: z.number().positive().default(50),
  promotionWeeklyConversions: z.number().positive().default(50),
});
export type FastLoopConfig = z.infer<typeof fastLoopConfigSchema>;

export async function getFastLoopConfig(repos: Repos): Promise<FastLoopConfig> {
  const stored = await repos.settings.get<Partial<FastLoopConfig>>("fast_loop");
  return fastLoopConfigSchema.parse({ ...(stored ?? {}) });
}

export interface CampaignPauser {
  pauseCampaign(action: ApprovedAction<PauseResumeAction>): Promise<void>;
}

/** Full control surface (pause/resume/update) for user rules. */
export type FastLoopAdapters = Adapters;

export interface FastLoopReport {
  halted: boolean;
  checked: number;
  paused: string[];
  anomalies: string[];
  promoted: string[];
  transitions: string[];
  /** User-rule actions executed this iteration (ruleId:campaignId). */
  ruleFired: string[];
  ruleNotified: string[];
  dryRun: boolean;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function lastNDays(insights: CampaignInsight[], endDate: string, n: number): CampaignInsight[] {
  return insights.filter((i) => i.date <= endDate).slice(-n);
}

async function proposePause(
  repos: Repos,
  adapters: Partial<Record<Platform, CampaignPauser>>,
  campaign: Campaign,
  productId: string | null,
  params: {
    actionType: string;
    rationale: string;
    evidence: { metric: string; window: string; result: string }[];
    dryRun: boolean;
  },
): Promise<boolean> {
  const adapter = adapters[campaign.platform];
  if (!adapter || !campaign.platformCampaignId) return false;
  const action: PauseResumeAction = {
    type: "pause_campaign",
    platform: campaign.platform,
    campaignId: campaign.id,
    platformCampaignId: campaign.platformCampaignId,
  };
  const outcome = await guardedExecute(
    repos,
    {
      loop: "fast",
      worker: "circuit-breaker",
      actionType: params.actionType,
      targetRef: `campaign:${campaign.id}`,
      rationale: params.rationale,
      evidence: params.evidence,
      predictedOutcome: "spend stops within minutes; no further budget at risk",
      productId,
      action,
      dryRun: params.dryRun,
    },
    (approved) => adapter.pauseCampaign(approved),
  );
  if (outcome.executed) {
    await repos.campaigns.update(campaign.id, { status: "paused" });
  }
  return outcome.executed;
}

/**
 * One fast-loop iteration. The kill switch is checked FIRST (invariant 2):
 * flipping it halts all writes and inference within one iteration.
 */
export async function runFastLoopOnce(
  deps: { repos: Repos; adapters: Adapters },
  opts: { dryRun?: boolean; now?: Date } = {},
): Promise<FastLoopReport> {
  const { repos, adapters } = deps;
  const dryRun = opts.dryRun ?? false;
  const now = opts.now ?? new Date();
  const report: FastLoopReport = {
    halted: false,
    checked: 0,
    paused: [],
    anomalies: [],
    promoted: [],
    transitions: [],
    ruleFired: [],
    ruleNotified: [],
    dryRun,
  };

  if (await repos.killSwitch.isEngaged()) {
    report.halted = true;
    return report;
  }
  const config = await getFastLoopConfig(repos);
  const today = isoDate(now);

  const campaigns = await repos.campaigns.listActive();
  for (const campaign of campaigns) {
    report.checked++;
    const spec = await repos.specs.get(campaign.specId);
    const productId = spec?.productId ?? null;
    const insights = await repos.insights.byCampaign(campaign.id);
    const weekly = lastNDays(insights, today, 7).reduce((s, i) => s + i.conversions, 0);

    // Lifecycle: Launching → Learning once delivery starts (UX §7).
    if (campaign.status === "launching" && insights.length > 0) {
      if (!dryRun) {
        await repos.campaigns.update(campaign.id, { status: "learning", learningState: "learning" });
      }
      await repos.decisions.insert({
        loop: "fast",
        worker: "lifecycle",
        actionType: "begin_learning",
        targetRef: `campaign:${campaign.id}`,
        rationale: "Delivery has started; gathering enough conversions to optimize reliably.",
        evidence: [{ metric: "delivery", window: "1d", result: "first report received" }],
        guardrailStatus: "passed",
        executed: !dryRun,
        productId,
      });
      report.transitions.push(`${campaign.id}:learning`);
    }

    // Learning exit at the volume threshold (Appendix C).
    if (campaign.learningState !== "exited" && weekly >= config.learningExitWeeklyConversions) {
      if (!dryRun) await repos.campaigns.update(campaign.id, { learningState: "exited" });
      await repos.decisions.insert({
        loop: "fast",
        worker: "lifecycle",
        actionType: "finish_learning",
        targetRef: `campaign:${campaign.id}`,
        rationale: `Finished learning — ${weekly} results in the last 7 days clears the threshold; now optimizing steadily.`,
        evidence: [{ metric: "weekly_conversions", window: "7d", result: String(weekly) }],
        guardrailStatus: "passed",
        executed: !dryRun,
        productId,
      });
      report.transitions.push(`${campaign.id}:learning_exited`);
    }

    // Zero-conversion burn pausing (deterministic loser-pausing).
    const burnWindow = lastNDays(insights, today, config.burnWindowDays);
    const burnSpend = burnWindow.reduce((s, i) => s + Number(i.spend), 0);
    const burnConversions = burnWindow.reduce((s, i) => s + i.conversions, 0);
    const budget = Number(campaign.budget);
    if (
      burnWindow.length > 0 &&
      burnConversions === 0 &&
      burnSpend >= budget * config.zeroConversionBurnMultiplier
    ) {
      const executed = await proposePause(repos, adapters, campaign, productId, {
        actionType: "pause_zero_conversion",
        rationale: `Paused: spent ${burnSpend.toFixed(0)} over ${burnWindow.length} day(s) with no results. Budget is safe; we'll suggest fresh ads or a different approach.`,
        evidence: [
          { metric: "spend", window: `${config.burnWindowDays}d`, result: burnSpend.toFixed(0) },
          { metric: "conversions", window: `${config.burnWindowDays}d`, result: "0" },
        ],
        dryRun,
      });
      report.paused.push(campaign.id);
      if (executed) continue; // paused — nothing further this iteration
      if (dryRun) continue;
    }

    // Spend anomaly circuit breaker (configurable z-score / multiplier).
    const todayRow = insights.find((i) => i.date === today);
    if (todayRow) {
      const trailing = insights.filter((i) => i.date < today).slice(-14);
      const todaySpend = Number(todayRow.spend);
      let anomalous = false;
      let detail = "";
      if (trailing.length >= 3) {
        const spends = trailing.map((i) => Number(i.spend));
        const mean = spends.reduce((a, b) => a + b, 0) / spends.length;
        const std = Math.sqrt(spends.reduce((a, b) => a + (b - mean) ** 2, 0) / spends.length);
        const z = std > 0 ? (todaySpend - mean) / std : Infinity;
        if (todaySpend > mean && z >= config.anomalyZScore && todaySpend > budget) {
          anomalous = true;
          detail = `today ${todaySpend.toFixed(0)} vs typical ${mean.toFixed(0)} (z=${Number.isFinite(z) ? z.toFixed(1) : "∞"})`;
        }
      }
      if (!anomalous && todaySpend >= budget * config.anomalySpendMultiplier) {
        anomalous = true;
        detail = `today ${todaySpend.toFixed(0)} is ${(todaySpend / budget).toFixed(1)}× the daily plan`;
      }
      if (anomalous) {
        await proposePause(repos, adapters, campaign, productId, {
          actionType: "pause_spend_anomaly",
          rationale: `Paused: spending much faster than planned (${detail}). Nothing more will be spent until this is checked.`,
          evidence: [{ metric: "spend_today", window: "1d", result: detail }],
          dryRun,
        });
        if (!dryRun) {
          await repos.attention.raise({
            kind: "spend_anomaly",
            severity: "error",
            message: "One of your products was spending much faster than planned, so we paused it.",
            fixHint: "Review the product and resume when ready.",
            targetRef: `campaign:${campaign.id}`,
          });
        }
        report.anomalies.push(campaign.id);
        continue;
      }
    }

    // Auto-promotion (SW §9.4 rule 3): allocation authority flips the moment
    // the slice clears its data threshold. No human gate, no calendar.
    if (!campaign.allocationAutonomous && weekly >= config.promotionWeeklyConversions) {
      if (!dryRun) {
        await repos.campaigns.update(campaign.id, {
          allocationAutonomous: true,
          promotedAt: now,
          status: "autonomous",
        });
      }
      await repos.decisions.insert({
        loop: "system",
        worker: "auto-promotion",
        actionType: "promote_allocation_authority",
        targetRef: `campaign:${campaign.id}`,
        rationale: `Enough reliable signal (${weekly} results in 7 days) — budget decisions for this slice are now made automatically within your limits.`,
        evidence: [{ metric: "weekly_conversions", window: "7d", result: String(weekly) }],
        guardrailStatus: "passed",
        executed: !dryRun,
        productId,
      });
      report.promoted.push(campaign.id);
    }
  }

  // User-defined rules (W9): deterministic, guardrail-gated, after the
  // built-in protections so anomaly pauses always run first.
  const rules = await runCustomRulesOnce({ repos, adapters }, { now, dryRun });
  report.ruleFired = rules.fired;
  report.ruleNotified = rules.notified;

  if (!dryRun) await rollUpProductStatuses(repos);
  return report;
}

/** Derive each product's lifecycle status from its campaigns (UX §7). */
export async function rollUpProductStatuses(repos: Repos): Promise<void> {
  const products = await repos.products.list();
  for (const product of products) {
    if (product.status === "draft" || product.status === "in_review") continue;
    const spec = await repos.specs.byProduct(product.id);
    if (!spec) continue;
    const campaigns = await repos.campaigns.bySpec(spec.id);
    if (campaigns.length === 0) continue;
    const statuses = new Set(campaigns.map((c) => c.status));
    let next: typeof product.status;
    if (statuses.has("needs_attention")) next = "needs_attention";
    else if ([...statuses].every((s) => s === "paused" || s === "ended")) next = "paused";
    else if (statuses.has("launching")) next = "launching";
    else if (statuses.has("learning")) next = "learning";
    else next = "autonomous";
    if (next !== product.status) await repos.products.update(product.id, { status: next });
  }
}
