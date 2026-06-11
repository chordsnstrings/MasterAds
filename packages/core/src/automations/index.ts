// Channel-keeping automations (SW §14 Phase One step 6, GOALS G9). Every
// platform-touching action flows as a Decision through the guardrail layer.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Campaign, Repos } from "@engine/db";
import type { ApprovedAction, PauseResumeAction, Platform, UpdateCampaignAction } from "../guardrails/approval.js";
import { guardedExecute } from "../guardrails/execute.js";

export interface CampaignControl {
  pauseCampaign(action: ApprovedAction<PauseResumeAction>): Promise<void>;
  resumeCampaign(action: ApprovedAction<PauseResumeAction>): Promise<void>;
  updateCampaign(action: ApprovedAction<UpdateCampaignAction>): Promise<void>;
}

export type Adapters = Partial<Record<Platform, CampaignControl>>;

async function campaignsForProduct(repos: Repos, productId: string): Promise<Campaign[]> {
  const spec = await repos.specs.byProduct(productId);
  if (!spec) return [];
  return repos.campaigns.bySpec(spec.id);
}

// ---------------------------------------------------------------------------
// Stock / price / promo auto-actions
// ---------------------------------------------------------------------------
export interface ChangeSweepReport {
  processed: number;
  paused: string[];
  resumed: string[];
  flaggedCreatives: string[];
}

/** Consume typed feed-change events (G4): stock-out pauses the product's ads
 * within the sync window; price change flags price-bearing creative for
 * regeneration; back-in-stock resumes. */
export async function processProductChanges(
  deps: { repos: Repos; adapters: Adapters },
  opts: { dryRun?: boolean } = {},
): Promise<ChangeSweepReport> {
  const { repos, adapters } = deps;
  const dryRun = opts.dryRun ?? false;
  const report: ChangeSweepReport = { processed: 0, paused: [], resumed: [], flaggedCreatives: [] };

  for (const change of await repos.productChanges.listUnprocessed()) {
    if (await repos.killSwitch.isEngaged()) break;

    if (change.changeType === "stock_out" || change.changeType === "back_in_stock") {
      const isPause = change.changeType === "stock_out";
      for (const campaign of await campaignsForProduct(repos, change.productId)) {
        if (!campaign.platformCampaignId) continue;
        if (isPause && (campaign.status === "paused" || campaign.status === "ended")) continue;
        if (!isPause && campaign.status !== "paused") continue;
        const adapter = adapters[campaign.platform];
        if (!adapter) continue;
        const action: PauseResumeAction = {
          type: isPause ? "pause_campaign" : "resume_campaign",
          platform: campaign.platform,
          campaignId: campaign.id,
          platformCampaignId: campaign.platformCampaignId,
        };
        const outcome = await guardedExecute(
          repos,
          {
            loop: "fast",
            worker: "channel-keeper",
            actionType: isPause ? "pause_stock_out" : "resume_back_in_stock",
            targetRef: `campaign:${campaign.id}`,
            rationale: isPause
              ? "This product sold out, so its ads are paused — no money goes to something people can't buy."
              : "Back in stock — ads are running again.",
            evidence: [
              {
                metric: "availability",
                window: "feed sync",
                result: isPause ? "out_of_stock" : "in_stock",
              },
            ],
            productId: change.productId,
            action,
            dryRun,
          },
          (approved) =>
            isPause ? adapter.pauseCampaign(approved) : adapter.resumeCampaign(approved),
        );
        if (outcome.executed) {
          await repos.campaigns.update(campaign.id, { status: isPause ? "paused" : "learning" });
          (isPause ? report.paused : report.resumed).push(campaign.id);
        }
      }
      if (!dryRun && isPause) {
        await repos.products.update(change.productId, { status: "paused" });
      }
    }

    if (change.changeType === "price_change") {
      const creatives = await repos.creatives.byProduct(change.productId);
      for (const creative of creatives) {
        if (!creative.priceBearing) continue;
        if (creative.status !== "ready" && creative.status !== "launched" && creative.status !== "held")
          continue;
        if (!dryRun) await repos.creatives.setStatus(creative.id, "expired");
        report.flaggedCreatives.push(creative.id);
      }
      if (report.flaggedCreatives.length > 0) {
        await repos.decisions.insert({
          loop: "fast",
          worker: "channel-keeper",
          actionType: "flag_price_creatives",
          targetRef: `product:${change.productId}`,
          rationale: `The price changed (${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}), so ads showing the old price were retired and fresh ones will be made.`,
          evidence: [
            {
              metric: "price",
              window: "feed sync",
              result: `${(change.before as { price?: number })?.price} → ${(change.after as { price?: number })?.price}`,
            },
          ],
          guardrailStatus: "passed",
          executed: !dryRun,
          productId: change.productId,
        });
      }
    }

    if (!dryRun) await repos.productChanges.markProcessed(change.id);
    report.processed++;
  }
  return report;
}

// ---------------------------------------------------------------------------
// Promo expiry
// ---------------------------------------------------------------------------
export async function expirePromos(
  repos: Repos,
  now: Date = new Date(),
): Promise<{ expiredPromos: number; expiredCreatives: string[] }> {
  const expiredCreatives: string[] = [];
  const due = await repos.promos.listExpiring(now);
  for (const promo of due) {
    const creatives = await repos.creatives.byProduct(promo.productId);
    for (const creative of creatives) {
      if (creative.promoId === promo.id && creative.status !== "expired") {
        await repos.creatives.setStatus(creative.id, "expired");
        expiredCreatives.push(creative.id);
      }
    }
    await repos.promos.markExpired(promo.id);
    await repos.decisions.insert({
      loop: "fast",
      worker: "channel-keeper",
      actionType: "expire_promo_creatives",
      targetRef: `promo:${promo.id}`,
      rationale: `The "${promo.label}" promotion ended, so its ads were taken down on time.`,
      evidence: [{ metric: "promo_end", window: "calendar", result: promo.endsAt.toISOString() }],
      guardrailStatus: "passed",
      executed: true,
      productId: promo.productId,
    });
  }
  return { expiredPromos: due.length, expiredCreatives };
}

// ---------------------------------------------------------------------------
// Billing / connection health
// ---------------------------------------------------------------------------
export interface HealthChecker {
  check(platform: Platform): Promise<{
    platform: Platform;
    tokenValid: boolean;
    billingOk: boolean;
    canRefresh: boolean;
  }>;
  refreshToken(platform: Platform): Promise<boolean>;
}

export async function runBillingHealth(
  repos: Repos,
  checker: HealthChecker,
  platforms: Platform[] = ["meta", "google", "tiktok", "snapchat", "pinterest"],
): Promise<{ healthy: Platform[]; refreshed: Platform[]; attention: Platform[] }> {
  const result = { healthy: [] as Platform[], refreshed: [] as Platform[], attention: [] as Platform[] };
  for (const platform of platforms) {
    const health = await checker.check(platform);
    let tokenValid = health.tokenValid;

    if (!tokenValid && health.canRefresh) {
      // Self-repair first; attention only when self-repair fails.
      const refreshed = await checker.refreshToken(platform);
      if (refreshed) {
        tokenValid = true;
        result.refreshed.push(platform);
        await repos.decisions.insert({
          loop: "system",
          worker: "connection-health",
          actionType: "token_refreshed",
          targetRef: `platform:${platform}`,
          rationale: `The ${platform} connection was expiring and renewed itself — nothing needed from you.`,
          evidence: [{ metric: "token_validity", window: "check", result: "renewed" }],
          guardrailStatus: "passed",
          executed: true,
        });
      }
    }

    await repos.adAccounts.upsert(platform, { tokenValid, billingOk: health.billingOk });

    if (!tokenValid) {
      result.attention.push(platform);
      await repos.attention.raise({
        kind: "connection_health",
        severity: "error",
        message: `The ${platform} connection stopped working and couldn't fix itself. Ads there can't be managed until it's reconnected.`,
        fixHint: "Reconnect the account in Settings → Connections.",
        targetRef: `platform:${platform}`,
      });
    } else if (!health.billingOk) {
      result.attention.push(platform);
      await repos.attention.raise({
        kind: "billing_issue",
        severity: "error",
        message: `Billing on the ${platform} account needs attention — ads stop delivering when billing fails.`,
        fixHint: "Check the payment method on the ad account.",
        targetRef: `platform:${platform}`,
      });
    } else {
      result.healthy.push(platform);
    }
  }
  return result;
}

/** Ad-account age in days (warm-up ramp input for the guardrail layer). */
export async function accountAgeDays(repos: Repos, platform: Platform, now = new Date()): Promise<number | undefined> {
  const account = await repos.adAccounts.get(platform);
  if (!account) return undefined;
  return Math.floor((now.getTime() - account.platformCreatedAt.getTime()) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Calendar-aware pacing (minimal): static regional events calendar as data.
// ---------------------------------------------------------------------------
const calendarSchema = z.array(
  z.object({
    name: z.string(),
    start: z.string(),
    end: z.string(),
    pacingMultiplier: z.number().positive(),
  }),
);
export type CalendarWindow = z.infer<typeof calendarSchema>[number];

export function loadCalendar(): CalendarWindow[] {
  const path = join(dirname(fileURLToPath(import.meta.url)), "calendar.json");
  return calendarSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function activeCalendarWindows(now: Date, calendar = loadCalendar()): CalendarWindow[] {
  const day = now.toISOString().slice(0, 10);
  return calendar.filter((w) => w.start <= day && day <= w.end);
}

/** Pre-adjust budgets for active calendar windows, within guardrail bounds.
 * Reaction lags CPM spikes — adjust ahead, never beyond the caps. */
export async function applyCalendarPacing(
  deps: { repos: Repos; adapters: Adapters },
  opts: { now?: Date; dryRun?: boolean } = {},
): Promise<{ adjusted: string[] }> {
  const { repos, adapters } = deps;
  const now = opts.now ?? new Date();
  const windows = activeCalendarWindows(now);
  const adjusted: string[] = [];
  if (windows.length === 0) return { adjusted };
  const window = windows.reduce((a, b) => (a.pacingMultiplier >= b.pacingMultiplier ? a : b));

  for (const campaign of await repos.campaigns.listActive()) {
    if (!campaign.allocationAutonomous || !campaign.platformCampaignId) continue;
    const current = Number(campaign.budget);
    const target = Math.round(current * window.pacingMultiplier * 100) / 100;
    if (Math.abs(target - current) < 1) continue;

    // One adjustment per campaign per window: skip if already done.
    const prior = (await repos.decisions.list({ actionType: "calendar_pacing" })).find(
      (d) =>
        d.targetRef === `campaign:${campaign.id}` &&
        d.executed &&
        d.createdAt >= new Date(`${window.start}T00:00:00Z`),
    );
    if (prior) continue;

    const adapter = adapters[campaign.platform];
    if (!adapter) continue;
    const spec = await repos.specs.get(campaign.specId);
    const action: UpdateCampaignAction = {
      type: "update_campaign",
      platform: campaign.platform,
      campaignId: campaign.id,
      platformCampaignId: campaign.platformCampaignId,
      changes: { dailyBudget: target },
    };
    const outcome = await guardedExecute(
      repos,
      {
        loop: "medium",
        worker: "calendar-pacing",
        actionType: "calendar_pacing",
        targetRef: `campaign:${campaign.id}`,
        rationale: `${window.name} is on — demand and ad prices rise, so the daily amount was adjusted ahead of time (${current.toFixed(0)} → ${target.toFixed(0)}), within your limits.`,
        evidence: [
          { metric: "calendar_window", window: `${window.start}–${window.end}`, result: window.name },
          { metric: "budget", window: "now", result: `${current.toFixed(0)} → ${target.toFixed(0)}` },
        ],
        predictedOutcome: "steadier delivery through the seasonal peak",
        productId: spec?.productId ?? null,
        action,
        context: { currentBudget: current },
        dryRun: opts.dryRun,
      },
      (approved) => adapter.updateCampaign(approved),
    );
    if (outcome.executed) {
      await repos.campaigns.update(campaign.id, { budget: target.toFixed(4) });
      adjusted.push(campaign.id);
    }
  }
  return { adjusted };
}
