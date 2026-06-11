// AI MANAGER (W10): the LLM reviews the whole account and proposes concrete
// management actions — budget changes, pausing/resuming, and new automation
// rules — across every connected platform. It can only ACT through the same
// guardrail layer as everything else (invariant 1): unforgeable approvals,
// kill switch, budget caps, max-step limits. It never runs in the fast loop
// (invariant 6); cadence is daily (scheduler) or on demand. Default posture
// is propose-only; "act within limits" is an explicit owner opt-in.
import { z } from "zod";
import type { Repos } from "@engine/db";
import type { InferenceClient } from "../classify/classifier.js";
import type { PauseResumeAction, UpdateCampaignAction } from "../guardrails/approval.js";
import { guardedExecute } from "../guardrails/execute.js";
import { getGuardrailConfig } from "../guardrails/config.js";
import type { Adapters } from "../automations/index.js";
import { ruleInputSchema } from "../automations/customRules.js";

const MAX_ACTIONS = 10;
const MAX_RULES = 20;

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_budget"),
    campaign_id: z.string(),
    daily_budget: z.number().finite().positive(),
    reason: z.string().min(1),
  }),
  z.object({
    type: z.literal("pause_product"),
    product_id: z.string(),
    reason: z.string().min(1),
  }),
  z.object({
    type: z.literal("resume_product"),
    product_id: z.string(),
    reason: z.string().min(1),
  }),
  z.object({
    type: z.literal("create_rule"),
    rule: z.unknown(),
    reason: z.string().min(1),
  }),
  z.object({ type: z.literal("note"), text: z.string().min(1) }),
]);

const planSchema = z.object({ actions: z.array(actionSchema).max(MAX_ACTIONS) });

export interface AiManagerSettings {
  enabled: boolean;
  /** false = propose-only (Decisions with executed=false); true = act within limits. */
  auto: boolean;
}

export async function getAiManagerSettings(repos: Repos): Promise<AiManagerSettings> {
  const stored = await repos.settings.get<Partial<AiManagerSettings>>("ai_manager");
  return { enabled: stored?.enabled ?? false, auto: stored?.auto ?? false };
}

export interface AiManagerReport {
  ran: boolean;
  dryRun: boolean;
  proposed: number;
  executed: string[];
  blocked: string[];
  rulesCreated: string[];
  notes: string[];
}

/** Compact account state the model reasons over (ids are ours, not platform). */
async function buildAccountState(repos: Repos, now: Date): Promise<string> {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const guardrails = await getGuardrailConfig(repos);
  const products = await repos.products.list();
  const rules = await repos.automationRules.list();
  const state: Record<string, unknown>[] = [];
  for (const p of products.slice(0, 25)) {
    const spec = await repos.specs.byProduct(p.id);
    if (!spec) continue;
    const campaigns = await repos.campaigns.bySpec(spec.id);
    const { adSpend, operatingCost } = await repos.costs.sumsByProduct(p.id, since);
    const conversions = (await repos.conversions.listCanonicalSince(since)).filter(
      (e) => e.contentId === p.id,
    );
    const revenue = conversions.reduce((s, e) => s + (e.value !== null ? Number(e.value) : 0), 0);
    state.push({
      product_id: p.id,
      title: p.title,
      status: p.status,
      goal: spec.goal ?? "best",
      last7d: {
        ad_spend: Number(adSpend.toFixed(2)),
        operating_cost: Number(operatingCost.toFixed(2)),
        results: conversions.length,
        revenue: Number(revenue.toFixed(2)),
        net_return:
          adSpend + operatingCost > 0
            ? Number((revenue / (adSpend + operatingCost)).toFixed(2))
            : null,
      },
      slices: campaigns.map((c) => ({
        campaign_id: c.id,
        platform: c.platform,
        status: c.status,
        daily_budget: Number(c.budget),
        autonomous: c.allocationAutonomous,
      })),
    });
  }
  return JSON.stringify({
    products: state,
    existing_rules: rules.map((r) => ({
      name: r.name,
      metric: r.metric,
      comparator: r.comparator,
      threshold: Number(r.threshold),
      action: r.action,
      enabled: r.enabled,
    })),
    limits: {
      global_daily_cap: guardrails.globalDailyCap,
      per_product_daily_cap: guardrails.perCampaignDailyCap,
      max_single_change_pct: guardrails.maxBudgetChangePct,
    },
  });
}

const SYSTEM_PROMPT = `You are the manager of an autonomous advertising account. Review the account state and propose at most ${MAX_ACTIONS} concrete actions. Respond ONLY with JSON:
{"actions":[
  {"type":"set_budget","campaign_id":string,"daily_budget":number,"reason":string} |
  {"type":"pause_product","product_id":string,"reason":string} |
  {"type":"resume_product","product_id":string,"reason":string} |
  {"type":"create_rule","rule":{"name":string,"metric":"spend"|"results"|"cost_per_result"|"net_return","window_days":1|3|7,"comparator":"gt"|"lt","threshold":number,"action":"pause"|"resume"|"notify","scope":"all"|"product","product_id"?:string},"reason":string} |
  {"type":"note","text":string}
]}
Principles: optimize net return (revenue over ad spend plus operating cost), respect the stated limits, prefer small reversible steps, pause clear losers, add rules only when a pattern repeats, and when nothing is needed say so in a note. Plain language reasons — no platform jargon.`;

export async function runAiManagerOnce(
  deps: { repos: Repos; llm: InferenceClient; adapters: Adapters },
  opts: { dryRun?: boolean; now?: Date } = {},
): Promise<AiManagerReport> {
  const { repos, llm, adapters } = deps;
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? true; // propose-only unless explicitly told to act
  const report: AiManagerReport = {
    ran: false,
    dryRun,
    proposed: 0,
    executed: [],
    blocked: [],
    rulesCreated: [],
    notes: [],
  };

  // Kill switch halts inference AND writes (invariant 2).
  if (await repos.killSwitch.isEngaged()) return report;
  report.ran = true;

  const { text } = await llm.complete({
    operation: "management",
    system: SYSTEM_PROMPT,
    prompt: await buildAccountState(repos, now),
    maxTokens: 1500,
  });
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("ai manager returned no JSON");
  const plan = planSchema.parse(JSON.parse(jsonMatch[0]));
  report.proposed = plan.actions.length;

  for (const action of plan.actions) {
    if (action.type === "note") {
      await repos.decisions.insert({
        loop: "medium",
        worker: "ai-manager",
        actionType: "ai_note",
        targetRef: "account",
        rationale: action.text,
        evidence: [],
        guardrailStatus: "passed",
        executed: false,
        productId: null,
      });
      report.notes.push(action.text);
      continue;
    }

    if (action.type === "create_rule") {
      const parsed = ruleInputSchema.safeParse(action.rule);
      if (!parsed.success || (await repos.automationRules.list()).length >= MAX_RULES) {
        report.blocked.push("create_rule");
        continue;
      }
      const r = parsed.data;
      if (!dryRun) {
        const created = await repos.automationRules.create({
          name: r.name,
          scope: r.scope,
          productId: r.product_id ?? null,
          metric: r.metric,
          windowDays: r.window_days,
          comparator: r.comparator,
          threshold: r.threshold.toFixed(4),
          action: r.action,
          cooldownHours: r.cooldown_hours,
        });
        report.rulesCreated.push(created.id);
      }
      await repos.decisions.insert({
        loop: "medium",
        worker: "ai-manager",
        actionType: "ai_create_rule",
        targetRef: "rules",
        rationale: `Added the rule "${r.name}" — ${action.reason}`,
        evidence: [
          { metric: r.metric, window: `${r.window_days}d`, result: `${r.comparator === "gt" ? ">" : "<"} ${r.threshold} → ${r.action}` },
        ],
        guardrailStatus: "passed",
        executed: !dryRun,
        productId: r.product_id ?? null,
      });
      continue;
    }

    if (action.type === "set_budget") {
      const campaign = await repos.campaigns.get(action.campaign_id);
      if (!campaign || !campaign.platformCampaignId) {
        report.blocked.push(`set_budget:${action.campaign_id}`);
        continue;
      }
      const adapter = adapters[campaign.platform];
      if (!adapter) continue;
      const current = Number(campaign.budget);
      const update: UpdateCampaignAction = {
        type: "update_campaign",
        platform: campaign.platform,
        campaignId: campaign.id,
        platformCampaignId: campaign.platformCampaignId,
        changes: { dailyBudget: action.daily_budget },
      };
      const spec = await repos.specs.get(campaign.specId);
      const outcome = await guardedExecute(
        repos,
        {
          loop: "medium",
          worker: "ai-manager",
          actionType: "ai_budget_change",
          targetRef: `campaign:${campaign.id}`,
          rationale: action.reason,
          evidence: [
            { metric: "budget", window: "now", result: `${current.toFixed(0)} → ${action.daily_budget.toFixed(0)}` },
          ],
          predictedOutcome: "net return improves within the owner's limits",
          productId: spec?.productId ?? null,
          action: update,
          context: { currentBudget: current },
          dryRun,
        },
        (approved) => adapter.updateCampaign(approved),
      );
      if (outcome.executed) {
        await repos.campaigns.update(campaign.id, { budget: action.daily_budget.toFixed(4) });
        report.executed.push(`set_budget:${campaign.id}`);
      } else if (outcome.decision.guardrailStatus === "blocked") {
        report.blocked.push(`set_budget:${campaign.id}`);
      }
      continue;
    }

    // pause_product / resume_product — every slice, through the guardrails.
    const pause = action.type === "pause_product";
    const spec = await repos.specs.byProduct(action.product_id);
    if (!spec) {
      report.blocked.push(`${action.type}:${action.product_id}`);
      continue;
    }
    const campaigns = (await repos.campaigns.bySpec(spec.id)).filter((c) =>
      pause
        ? c.status === "launching" || c.status === "learning" || c.status === "autonomous"
        : c.status === "paused",
    );
    for (const campaign of campaigns) {
      const adapter = adapters[campaign.platform];
      if (!adapter || !campaign.platformCampaignId) continue;
      const pr: PauseResumeAction = {
        type: pause ? "pause_campaign" : "resume_campaign",
        platform: campaign.platform,
        campaignId: campaign.id,
        platformCampaignId: campaign.platformCampaignId,
      };
      const outcome = await guardedExecute(
        repos,
        {
          loop: "medium",
          worker: "ai-manager",
          actionType: pause ? "ai_pause" : "ai_resume",
          targetRef: `campaign:${campaign.id}`,
          rationale: action.reason,
          evidence: [],
          predictedOutcome: pause ? "spend stops within minutes" : "delivery resumes within minutes",
          productId: action.product_id,
          action: pr,
          dryRun,
        },
        (approved) => (pause ? adapter.pauseCampaign(approved) : adapter.resumeCampaign(approved)),
      );
      if (outcome.executed) {
        await repos.campaigns.update(campaign.id, { status: pause ? "paused" : "learning" });
        report.executed.push(`${action.type}:${campaign.id}`);
      }
    }
  }
  return report;
}
