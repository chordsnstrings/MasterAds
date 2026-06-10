// Deterministic pre-action validation (SW §10.1-10.2): pure functions over the
// proposed action + observed context. The decision layer proposes; this layer
// constrains the action space. Post-hoc filtering is too late — these run
// BEFORE execution, always.
import type { PlatformAction } from "./approval.js";
import type { GuardrailConfig } from "./config.js";

export interface GuardrailContext {
  /** Current daily budget of the target campaign (update/duplicate/resume). */
  currentBudget?: number;
  /** Sum of daily budgets across the target vertical, excluding this action. */
  verticalDailyBudget?: number;
  /** Sum of daily budgets across all campaigns, excluding this action. */
  globalDailyBudget?: number;
  /** Last time this object was changed by the engine. */
  lastChangeAt?: Date;
  /** Objects this decision touches (blast radius). */
  objectsTouched?: number;
  /** Operating cost spent today (USD) for the product / globally. */
  productOperatingCostTodayUsd?: number;
  globalOperatingCostTodayUsd?: number;
  /** Ad account age in days (warm-up ramp, G9). */
  accountAgeDays?: number;
  now?: Date;
}

export interface GuardrailVerdict {
  verdict: "passed" | "blocked";
  violations: string[];
}

function proposedBudget(action: PlatformAction): number | undefined {
  switch (action.type) {
    case "create_campaign":
      return action.payload.dailyBudget;
    case "update_campaign":
      return action.changes.dailyBudget;
    case "duplicate_campaign":
      return action.overrides.dailyBudget;
    default:
      return undefined;
  }
}

export function evaluateAction(
  action: PlatformAction,
  config: GuardrailConfig,
  context: GuardrailContext = {},
): GuardrailVerdict {
  const violations: string[] = [];
  const now = context.now ?? new Date();
  const budget = proposedBudget(action);

  // Spend caps.
  if (budget !== undefined) {
    if (budget > config.perCampaignDailyCap) {
      violations.push(
        `daily budget ${budget} exceeds the per-campaign cap ${config.perCampaignDailyCap} ${config.currency}`,
      );
    }
    if (
      context.verticalDailyBudget !== undefined &&
      context.verticalDailyBudget + budget > config.perVerticalDailyCap
    ) {
      violations.push(
        `vertical daily total ${context.verticalDailyBudget + budget} would exceed the vertical cap ${config.perVerticalDailyCap} ${config.currency}`,
      );
    }
    if (
      context.globalDailyBudget !== undefined &&
      context.globalDailyBudget + budget > config.globalDailyCap
    ) {
      violations.push(
        `global daily total ${context.globalDailyBudget + budget} would exceed the global cap ${config.globalDailyCap} ${config.currency}`,
      );
    }
    // Warm-up ramp on young accounts (G9).
    if (
      context.accountAgeDays !== undefined &&
      context.accountAgeDays < config.warmupAccountAgeDays &&
      budget > config.warmupMaxDailyBudget
    ) {
      violations.push(
        `account is ${context.accountAgeDays} days old; warm-up caps daily budget at ${config.warmupMaxDailyBudget} ${config.currency}`,
      );
    }
  }

  // Max change size per step.
  if (
    action.type === "update_campaign" &&
    action.changes.dailyBudget !== undefined &&
    context.currentBudget !== undefined &&
    context.currentBudget > 0
  ) {
    const changePct =
      (Math.abs(action.changes.dailyBudget - context.currentBudget) / context.currentBudget) * 100;
    if (changePct > config.maxBudgetChangePct) {
      violations.push(
        `budget change of ${changePct.toFixed(0)}% exceeds the max change per step (${config.maxBudgetChangePct}%)`,
      );
    }
  }

  // Change-frequency limit (no thrashing).
  if (
    (action.type === "update_campaign" || action.type === "pause_campaign" || action.type === "resume_campaign") &&
    context.lastChangeAt !== undefined
  ) {
    const hoursSince = (now.getTime() - context.lastChangeAt.getTime()) / 3_600_000;
    if (hoursSince < config.minChangeIntervalHours) {
      violations.push(
        `object changed ${hoursSince.toFixed(1)}h ago; minimum interval is ${config.minChangeIntervalHours}h`,
      );
    }
  }

  // Blast radius.
  if (
    context.objectsTouched !== undefined &&
    context.objectsTouched > config.maxObjectsPerDecision
  ) {
    violations.push(
      `decision touches ${context.objectsTouched} objects; the blast-radius limit is ${config.maxObjectsPerDecision}`,
    );
  }

  // Operating-cost caps (a regeneration loop is bounded like runaway spend).
  if (
    context.productOperatingCostTodayUsd !== undefined &&
    context.productOperatingCostTodayUsd > config.perProductOperatingCostDailyCapUsd
  ) {
    violations.push(
      `product operating cost today $${context.productOperatingCostTodayUsd.toFixed(2)} exceeds the per-product cap $${config.perProductOperatingCostDailyCapUsd}`,
    );
  }
  if (
    context.globalOperatingCostTodayUsd !== undefined &&
    context.globalOperatingCostTodayUsd > config.operatingCostDailyCapUsd
  ) {
    violations.push(
      `global operating cost today $${context.globalOperatingCostTodayUsd.toFixed(2)} exceeds the global cap $${config.operatingCostDailyCapUsd}`,
    );
  }

  return { verdict: violations.length > 0 ? "blocked" : "passed", violations };
}
