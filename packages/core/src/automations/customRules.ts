// User-defined automation rules (W9, Birch-style). Evaluated INSIDE the
// deterministic fast loop (invariant 6 — no LLM); pause/resume actions run
// only through the guardrail layer (invariant 1), so every firing is a
// Decision the owner can read in Activity. Rules are settings; the Decisions
// they produce are the audit trail.
import { z } from "zod";
import type { AutomationRule, Campaign, CampaignInsight, Repos } from "@engine/db";
import type { PauseResumeAction } from "../guardrails/approval.js";
import { guardedExecute } from "../guardrails/execute.js";
import type { Adapters } from "./index.js";

export const RULE_METRICS = ["spend", "results", "cost_per_result", "net_return"] as const;
export const RULE_WINDOWS = [1, 3, 7] as const;

/** Shared by the API route; one source of truth for what a rule may contain. */
export const ruleInputSchema = z.object({
  name: z.string().min(1).max(80),
  scope: z.enum(["all", "product"]).default("all"),
  product_id: z.string().optional(),
  metric: z.enum(RULE_METRICS),
  window_days: z.union([z.literal(1), z.literal(3), z.literal(7)]).default(3),
  comparator: z.enum(["gt", "lt"]),
  threshold: z.number().finite().positive(),
  action: z.enum(["pause", "resume", "notify"]),
  cooldown_hours: z.number().int().min(1).max(24 * 14).default(24),
}).refine((r) => r.scope === "all" || Boolean(r.product_id), {
  message: "product_id required when scope is product",
});

const METRIC_LABELS: Record<string, string> = {
  spend: "spend",
  results: "results",
  cost_per_result: "cost per result",
  net_return: "money back per cost",
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Metric over the window slice. Undefined means "not decidable" and the rule
 * does not fire: cost_per_result with zero results is owned by the built-in
 * zero-conversion pause; net_return with zero spend has no denominator.
 */
export function computeRuleMetric(
  rows: CampaignInsight[],
  metric: AutomationRule["metric"],
): number | undefined {
  const spend = rows.reduce((s, i) => s + Number(i.spend), 0);
  const conversions = rows.reduce((s, i) => s + i.conversions, 0);
  const revenue = rows.reduce((s, i) => s + Number(i.revenue), 0);
  switch (metric) {
    case "spend":
      return spend;
    case "results":
      return conversions;
    case "cost_per_result":
      return conversions > 0 ? spend / conversions : undefined;
    case "net_return":
      return spend > 0 ? revenue / spend : undefined;
  }
}

export interface CustomRulesReport {
  checked: number;
  fired: string[];
  notified: string[];
}

const ACTION_STATUSES: Record<AutomationRule["action"], Set<Campaign["status"]>> = {
  pause: new Set(["launching", "learning", "autonomous"]),
  notify: new Set(["launching", "learning", "autonomous"]),
  resume: new Set(["paused"]),
};

export async function runCustomRulesOnce(
  deps: { repos: Repos; adapters: Adapters },
  opts: { now?: Date; dryRun?: boolean } = {},
): Promise<CustomRulesReport> {
  const { repos, adapters } = deps;
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? false;
  const report: CustomRulesReport = { checked: 0, fired: [], notified: [] };

  // Kill switch halts everything (also gated by the calling loop).
  if (await repos.killSwitch.isEngaged()) return report;

  const rules = await repos.automationRules.listEnabled();
  if (rules.length === 0) return report;
  const today = isoDate(now);

  for (const rule of rules) {
    // Anti-flapping cooldown per rule.
    if (
      rule.lastFiredAt &&
      now.getTime() < rule.lastFiredAt.getTime() + rule.cooldownHours * 3_600_000
    ) {
      continue;
    }

    let campaigns: Campaign[];
    if (rule.scope === "product" && rule.productId) {
      const spec = await repos.specs.byProduct(rule.productId);
      campaigns = spec ? await repos.campaigns.bySpec(spec.id) : [];
    } else {
      campaigns = await repos.campaigns.list();
    }
    const eligible = campaigns.filter((c) => ACTION_STATUSES[rule.action].has(c.status));

    let firedThisRule = false;
    for (const campaign of eligible) {
      report.checked++;
      const insights = await repos.insights.byCampaign(campaign.id);
      const window = insights.filter((i) => i.date <= today).slice(-rule.windowDays);
      if (window.length === 0) continue;
      const value = computeRuleMetric(window, rule.metric);
      if (value === undefined) continue;
      const threshold = Number(rule.threshold);
      const matched = rule.comparator === "gt" ? value > threshold : value < threshold;
      if (!matched) continue;

      const spec = await repos.specs.get(campaign.specId);
      const productId = spec?.productId ?? null;
      const product = productId ? await repos.products.get(productId) : undefined;
      const metricLabel = METRIC_LABELS[rule.metric] ?? rule.metric;
      const direction = rule.comparator === "gt" ? "above" : "below";
      const evidence = [
        { metric: rule.metric, window: `${rule.windowDays}d`, result: value.toFixed(2) },
        { metric: "rule", window: "—", result: rule.name },
      ];

      if (rule.action === "notify") {
        await repos.decisions.insert({
          loop: "fast",
          worker: "custom-rules",
          actionType: "custom_rule_notify",
          targetRef: `campaign:${campaign.id}`,
          rationale: `Your rule "${rule.name}" matched${product ? ` for ${product.title}` : ""}: ${metricLabel} over the last ${rule.windowDays} day(s) was ${value.toFixed(2)}, ${direction} your limit of ${threshold}.`,
          evidence,
          guardrailStatus: "passed",
          executed: !dryRun,
          productId,
        });
        if (!dryRun) {
          await repos.attention.raise({
            kind: "custom_rule",
            severity: "warning",
            message: `Your rule "${rule.name}" matched${product ? ` for ${product.title}` : ""}.`,
            fixHint: `${metricLabel} over the last ${rule.windowDays} day(s) was ${value.toFixed(2)}, ${direction} your limit of ${threshold}.`,
            targetRef: `rule:${rule.id}:campaign:${campaign.id}`,
          });
          await repos.notifications.queue({
            kind: "custom_rule",
            dedupKey: `rule:${rule.id}:${campaign.id}:${today}`,
            subject: `Your rule "${rule.name}" matched`,
            body: `${metricLabel} over the last ${rule.windowDays} day(s) was ${value.toFixed(2)}, ${direction} your limit of ${threshold}${product ? ` for ${product.title}` : ""}. Open the Overview screen to act on this.`,
          });
        }
        report.notified.push(`${rule.id}:${campaign.id}`);
        firedThisRule = true;
        continue;
      }

      const adapter = adapters[campaign.platform];
      if (!adapter || !campaign.platformCampaignId) continue;
      const pause = rule.action === "pause";
      const action: PauseResumeAction = {
        type: pause ? "pause_campaign" : "resume_campaign",
        platform: campaign.platform,
        campaignId: campaign.id,
        platformCampaignId: campaign.platformCampaignId,
      };
      const outcome = await guardedExecute(
        repos,
        {
          loop: "fast",
          worker: "custom-rules",
          actionType: "custom_rule",
          targetRef: `campaign:${campaign.id}`,
          rationale: `Your rule "${rule.name}" matched: ${metricLabel} over the last ${rule.windowDays} day(s) was ${value.toFixed(2)}, ${direction} your limit of ${threshold}. ${pause ? "Paused — nothing more is spent until you or a rule resumes it." : "Resumed — running again within your limits."}`,
          evidence,
          predictedOutcome: pause
            ? "spend stops within minutes"
            : "delivery resumes within minutes",
          productId,
          action,
          dryRun,
        },
        (approved) => (pause ? adapter.pauseCampaign(approved) : adapter.resumeCampaign(approved)),
      );
      if (outcome.executed) {
        await repos.campaigns.update(campaign.id, {
          status: pause ? "paused" : "learning",
        });
        report.fired.push(`${rule.id}:${campaign.id}`);
        firedThisRule = true;
      }
    }

    if (firedThisRule && !dryRun) {
      await repos.automationRules.markFired(rule.id, now);
    }
  }
  return report;
}
