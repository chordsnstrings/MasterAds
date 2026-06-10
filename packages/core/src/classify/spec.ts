// CampaignSpec construction: classification + playbook + user intent → the
// canonical spec every product maps into (SW §5.2-5.3).
import type { CampaignSpec, Product, Repos } from "@engine/db";
import { selectPlaybook } from "../playbooks/index.js";
import { selectOptimizationEvent } from "./eventSelection.js";
import type { Classification } from "./classifier.js";

/** Plain-outcome goals (FLOW §5.3) → terminal event override. */
export const GOAL_EVENT_MAP: Record<string, string | undefined> = {
  best: undefined, // We'll choose the best — engine decides
  more_sales: "Purchase",
  more_enquiries: "Lead",
  more_bookings: "Lead",
  more_app_installs: "Install",
  more_website_visits: "ViewContent",
};

/** Suggested daily budget (AED) by price tier — FLOW §5.5 "We'll suggest". */
export function suggestDailyBudget(priceTier: Classification["priceTier"]): number {
  return { low: 150, mid: 300, high: 500, premium: 800 }[priceTier];
}

export interface BuildSpecOptions {
  goal?: string;
  dailyBudget?: number;
  budgetCurrency?: string;
  destination?: { kind: "url" | "hosted_page" | "hosted_form" | "whatsapp" | "call"; value: string };
}

export async function buildSpecForProduct(
  repos: Repos,
  product: Product,
  classification: Classification,
  opts: BuildSpecOptions = {},
): Promise<CampaignSpec> {
  const playbook = await selectPlaybook(repos, classification.vertical, classification.businessModel);

  const goal = opts.goal ?? "best";
  const terminalEvent = GOAL_EVENT_MAP[goal] ?? classification.terminalEvent;
  const funnelStages =
    terminalEvent === classification.terminalEvent
      ? classification.funnelStages
      : playbook.funnelEvents.includes(terminalEvent)
        ? playbook.funnelEvents
        : [...playbook.funnelEvents, terminalEvent];

  const selection = selectOptimizationEvent({
    terminalEvent,
    expectedWeeklyTerminalVolume: classification.expectedWeeklyTerminalVolume,
    funnelStages,
  });

  const restricted =
    classification.policyCategory === "restricted" || playbook.requiresSignoff === true;

  return repos.specs.insert({
    productId: product.id,
    playbookId: playbook.id,
    businessModel: classification.businessModel,
    terminalEvent,
    optimizationEvent: selection.optimizationEvent,
    funnelStages,
    priceTier: classification.priceTier,
    creativeAngle: playbook.creativeAngles.includes(classification.creativeAngle)
      ? classification.creativeAngle
      : (playbook.creativeAngles[0] ?? classification.creativeAngle),
    policyCategory: restricted ? "restricted" : "standard",
    targetPlatforms: playbook.targetPlatforms,
    audienceStrategy: playbook.audienceStrategy,
    formatMix: playbook.formatMix,
    goal,
    dailyBudget: (opts.dailyBudget ?? suggestDailyBudget(classification.priceTier)).toFixed(4),
    budgetCurrency: opts.budgetCurrency ?? "AED",
    destination:
      opts.destination ?? (product.url ? { kind: "url", value: product.url } : null),
    consolidationGroup: selection.consolidate
      ? `consolidated:${classification.vertical}`
      : null,
  });
}
