// Event-selection re-evaluation (SW §5.3, GOALS G10): as real volume grows,
// re-check each product's optimization event and DEEPEN it when the terminal
// event clears the learning threshold on measured (not estimated) volume.
import type { Repos } from "@engine/db";
import type { ApprovedAction, Platform, UpdateCampaignAction } from "../guardrails/approval.js";
import { guardedExecute } from "../guardrails/execute.js";
import { selectOptimizationEvent, LEARNING_THRESHOLD_PER_WEEK } from "../classify/eventSelection.js";

export interface EventUpdater {
  updateCampaign(action: ApprovedAction<UpdateCampaignAction>): Promise<void>;
}

export async function reevaluateOptimizationEvents(
  deps: { repos: Repos; adapters: Partial<Record<Platform, EventUpdater>> },
  opts: { now?: Date; dryRun?: boolean } = {},
): Promise<{ deepened: { specId: string; from: string; to: string }[] }> {
  const { repos, adapters } = deps;
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const deepened: { specId: string; from: string; to: string }[] = [];
  if (await repos.killSwitch.isEngaged()) return { deepened };

  const canonical = await repos.conversions.listCanonicalSince(since);

  for (const campaign of await repos.campaigns.listActive()) {
    const spec = await repos.specs.get(campaign.specId);
    if (!spec || spec.optimizationEvent === spec.terminalEvent) continue;

    const weeklyTerminal = canonical.filter(
      (e) => e.contentId === spec.productId && e.eventName === spec.terminalEvent,
    ).length;
    const selection = selectOptimizationEvent({
      terminalEvent: spec.terminalEvent,
      expectedWeeklyTerminalVolume: weeklyTerminal,
      funnelStages: spec.funnelStages,
    });
    // Only ever deepen (toward the terminal event); never shallow out on noise.
    if (
      selection.optimizationEvent === spec.optimizationEvent ||
      weeklyTerminal < LEARNING_THRESHOLD_PER_WEEK
    )
      continue;

    if (!campaign.platformCampaignId) continue;
    const adapter = adapters[campaign.platform];
    if (!adapter) continue;
    const action: UpdateCampaignAction = {
      type: "update_campaign",
      platform: campaign.platform,
      campaignId: campaign.id,
      platformCampaignId: campaign.platformCampaignId,
      changes: {},
    };
    const outcome = await guardedExecute(
      repos,
      {
        loop: "medium",
        worker: "event-selection",
        actionType: "deepen_optimization_event",
        targetRef: `campaign:${campaign.id}`,
        rationale: `Now optimizing for ${spec.terminalEvent === "Purchase" ? "purchases" : "results"} directly — ${weeklyTerminal} real results last week clears the reliability threshold.`,
        evidence: [
          { metric: "weekly_terminal_volume", window: "7d", result: String(weeklyTerminal) },
          { metric: "optimization_target", window: "now", result: `${spec.optimizationEvent} → ${selection.optimizationEvent}` },
        ],
        predictedOutcome: "optimizer aligns to the true business outcome with enough signal to stay stable",
        productId: spec.productId,
        action,
        dryRun: opts.dryRun,
      },
      (approved) => adapter.updateCampaign(approved),
    );
    if (outcome.executed) {
      await repos.specs.update(spec.id, { optimizationEvent: selection.optimizationEvent });
      await repos.campaigns.update(campaign.id, { optimizationEvent: selection.optimizationEvent });
      deepened.push({ specId: spec.id, from: spec.optimizationEvent, to: selection.optimizationEvent });
    }
  }
  return { deepened };
}
