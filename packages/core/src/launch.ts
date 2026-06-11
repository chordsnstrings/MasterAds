// Launch orchestration (SW §5.5, GOALS G7): CampaignSpec + selected creatives →
// platform campaigns via guardedExecute (invariant 1), Campaign rows persisted,
// lifecycle set to Launching. Idempotent: re-running cannot double-create.
import type { Campaign, CampaignSpec, Repos } from "@engine/db";
import {
  type ApprovedAction,
  type CreateCampaignAction,
  type Platform,
} from "./guardrails/approval.js";
import { guardedExecute } from "./guardrails/execute.js";
import { checkLaunchGate } from "./classify/launchGate.js";

/** Structural subset of the platform adapter used by launch. */
export interface CampaignCreator {
  createCampaign(action: ApprovedAction<CreateCampaignAction>): Promise<{ platformCampaignId: string }>;
}

const CAMPAIGN_TYPES: Record<Platform, string> = {
  meta: "advantage_plus",
  google: "performance_max",
  tiktok: "smart_plus",
  snapchat: "snap_automated",
  pinterest: "performance_plus",
};

const OBJECTIVE_BY_TERMINAL: Record<string, CreateCampaignAction["payload"]["objective"]> = {
  Purchase: "purchases",
  Lead: "leads",
  CompleteRegistration: "registrations",
  Install: "installs",
  ViewContent: "visits",
};

export function destinationUrl(spec: CampaignSpec, baseUrl: string): string | undefined {
  const d = spec.destination;
  if (!d) return undefined;
  switch (d.kind) {
    case "url":
      return d.value;
    case "hosted_page":
      return `${baseUrl}/hosted/p/${spec.productId}`;
    case "hosted_form":
      return `${baseUrl}/hosted/f/${spec.productId}`;
    case "whatsapp":
      // Measured CTWA-lite redirect: click IDs captured before the handoff.
      return `${baseUrl}/hosted/wa/${spec.productId}?p=${d.value.replace(/[^\d]/g, "")}`;
    case "call":
      return `tel:${d.value}`;
  }
}

export type LaunchResult =
  | { kind: "launched"; campaigns: Campaign[]; blockedPlatforms: { platform: string; reasons: string[] }[] }
  | { kind: "blocked_restricted"; message: string }
  | { kind: "no_creatives" }
  | { kind: "no_destination" };

export async function launchProduct(
  deps: { repos: Repos; adapters: Record<Platform, CampaignCreator>; baseUrl?: string },
  specId: string,
): Promise<LaunchResult> {
  const { repos, adapters } = deps;
  const baseUrl = deps.baseUrl ?? process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";

  const spec = await repos.specs.get(specId);
  if (!spec) throw new Error(`spec ${specId} not found`);
  const product = await repos.products.get(spec.productId);
  if (!product) throw new Error(`product ${spec.productId} not found`);

  // Restricted gate (invariant 9): Submit for review, never Launch.
  const gate = await checkLaunchGate(repos, spec);
  if (!gate.allowed) {
    return { kind: "blocked_restricted", message: gate.message };
  }

  const url = destinationUrl(spec, baseUrl);
  if (!url) return { kind: "no_destination" };

  const allCreatives = await repos.creatives.byProduct(product.id);
  const launchable = allCreatives.filter((c) => c.status === "ready" || c.status === "launched");
  if (launchable.length === 0) return { kind: "no_creatives" };

  // Budget context for guardrails: current totals exclude this spec's campaigns.
  const active = await repos.campaigns.listActive();
  const globalDailyBudget = active.reduce((sum, c) => sum + Number(c.budget), 0);

  // W11: the spec's daily budget is the campaign TOTAL — split it across the
  // chosen channels (equal start; the daily reallocation loop then shifts the
  // split toward whichever channel performs best).
  const totalDailyBudget = Number(spec.dailyBudget ?? 0);
  const platformCount = Math.max(spec.targetPlatforms.length, 1);
  const dailyBudget = Math.max(
    Math.round((totalDailyBudget / platformCount) * 100) / 100,
    totalDailyBudget > 0 ? 1 : 0,
  );
  const objective = OBJECTIVE_BY_TERMINAL[spec.terminalEvent] ?? "purchases";
  const launched: Campaign[] = [];
  const blockedPlatforms: { platform: string; reasons: string[] }[] = [];

  for (const platformName of spec.targetPlatforms) {
    const platform = platformName as Platform;
    const adapter = adapters[platform];
    if (!adapter) continue;

    // Idempotency: an existing campaign row with a platform id is a no-op.
    const existing = (await repos.campaigns.bySpec(spec.id)).find((c) => c.platform === platform);
    if (existing?.platformCampaignId) {
      launched.push(existing);
      continue;
    }

    const action: CreateCampaignAction = {
      type: "create_campaign",
      platform,
      specId: spec.id,
      payload: {
        name: `${product.title} — ${platform}`,
        objective,
        optimizationEvent: spec.optimizationEvent,
        dailyBudget,
        currency: spec.budgetCurrency ?? "AED",
        destinationUrl: url,
        creativeIds: launchable.map((c) => c.id),
        contentIds: [product.id],
        policyCategory: spec.policyCategory,
      },
    };

    const outcome = await guardedExecute(
      repos,
      {
        loop: "system",
        worker: "launcher",
        actionType: "launch_campaign",
        targetRef: `spec:${spec.id}:${platform}`,
        rationale: `Launching ${product.title} on ${platform} optimizing toward ${spec.optimizationEvent} at ${dailyBudget} ${spec.budgetCurrency ?? "AED"}/day.`,
        predictedOutcome: `delivery begins and learning starts within 48h`,
        productId: product.id,
        action,
        context: { globalDailyBudget },
      },
      (approved) => adapter.createCampaign(approved),
    );

    if (outcome.executed && outcome.result) {
      const campaign = await repos.campaigns.insertIdempotent({
        specId: spec.id,
        platform,
        platformCampaignId: outcome.result.platformCampaignId,
        campaignType: CAMPAIGN_TYPES[platform],
        objective,
        optimizationEvent: spec.optimizationEvent,
        budget: dailyBudget.toFixed(4),
        budgetMode: "daily",
        status: "launching",
        learningState: "pending",
      });
      launched.push(campaign);
    } else {
      blockedPlatforms.push({ platform, reasons: outcome.blockedReasons ?? ["blocked"] });
    }
  }

  if (launched.length > 0) {
    await repos.products.update(product.id, { status: "launching" });
    for (const c of launchable) {
      if (c.status === "ready") await repos.creatives.setStatus(c.id, "launched");
    }
  }

  return { kind: "launched", campaigns: launched, blockedPlatforms };
}
