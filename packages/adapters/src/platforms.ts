// Platform campaign adapters (SW §5.5, §7.3, §12) for the AI campaign types:
// Meta Advantage+, Google Performance Max, TikTok Smart+, Snapchat automated
// (auto-bid), Pinterest Performance+. Live/stub drivers.
//
// Invariants enforced here, in every write method:
//  - assertApproved(action): only guardrail-approved action objects execute.
//  - kill switch checked before every write (invariant 2).
//
// Rate-limit / async-report notes (SW §12):
//  - Meta: per-business-use-case quota shared across endpoints; a mutation rate
//    cap applies; large insights pulls must use the async report workflow
//    (report run IDs expire after 30 days). Live driver must batch and back off.
//  - Google: monthly version churn with fixed sunsets — version pinned below;
//    RMF compliance documented in BLOCKED.md before live launch.
//  - TikTok: batch creation endpoints exist; blocked-word utilities should be
//    called before submitting text assets in live mode.
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Repos } from "@engine/db";
import {
  assertApproved,
  type ApprovedAction,
  type CreateCampaignAction,
  type DuplicateCampaignAction,
  type PauseResumeAction,
  type Platform,
  type UpdateCampaignAction,
  type UploadCreativeAction,
} from "@engine/core";
import { driverMode, type DriverMode } from "./env.js";

export interface InsightsReport {
  date: string; // yyyy-mm-dd
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  currency: string;
}

export interface PlatformAdapter {
  readonly platform: Platform;
  readonly mode: DriverMode;
  createCampaign(action: ApprovedAction<CreateCampaignAction>): Promise<{ platformCampaignId: string }>;
  updateCampaign(action: ApprovedAction<UpdateCampaignAction>): Promise<void>;
  pauseCampaign(action: ApprovedAction<PauseResumeAction>): Promise<void>;
  resumeCampaign(action: ApprovedAction<PauseResumeAction>): Promise<void>;
  duplicateCampaign(action: ApprovedAction<DuplicateCampaignAction>): Promise<{ platformCampaignId: string }>;
  uploadCreative(action: ApprovedAction<UploadCreativeAction>): Promise<{ platformAssetRef: string }>;
  /** Reads are not mutations: no approval object required. */
  readInsights(scope: { platformCampaignId: string }, window: { date: string }): Promise<InsightsReport>;
  /** The exact outbound payload for a create action (snapshot-tested). */
  buildCreatePayload(action: CreateCampaignAction): Record<string, unknown>;
}

// --- Canonical event/objective → platform enums (Appendix A) -----------------
const META_OPT_EVENTS: Record<string, string> = {
  Purchase: "PURCHASE",
  InitiateCheckout: "INITIATE_CHECKOUT",
  AddToCart: "ADD_TO_CART",
  ViewContent: "VIEW_CONTENT",
  Lead: "LEAD",
  CompleteRegistration: "COMPLETE_REGISTRATION",
  Install: "APP_INSTALL",
};
const META_OBJECTIVES: Record<CreateCampaignAction["payload"]["objective"], string> = {
  purchases: "OUTCOME_SALES",
  leads: "OUTCOME_LEADS",
  registrations: "OUTCOME_LEADS",
  installs: "OUTCOME_APP_PROMOTION",
  visits: "OUTCOME_TRAFFIC",
};
const TIKTOK_OPT_EVENTS: Record<string, string> = {
  Purchase: "COMPLETE_PAYMENT",
  InitiateCheckout: "INITIATE_CHECKOUT",
  AddToCart: "ADD_TO_CART",
  ViewContent: "VIEW_CONTENT",
  Lead: "SUBMIT_FORM",
  CompleteRegistration: "COMPLETE_REGISTRATION",
  Install: "APP_INSTALL",
};
const TIKTOK_OBJECTIVES: Record<CreateCampaignAction["payload"]["objective"], string> = {
  purchases: "PRODUCT_SALES",
  leads: "LEAD_GENERATION",
  registrations: "LEAD_GENERATION",
  installs: "APP_PROMOTION",
  visits: "TRAFFIC",
};
const SNAP_OPT_EVENTS: Record<string, string> = {
  Purchase: "PIXEL_PURCHASE",
  InitiateCheckout: "PIXEL_START_CHECKOUT",
  AddToCart: "PIXEL_ADD_TO_CART",
  ViewContent: "PIXEL_PAGE_VIEW",
  Lead: "LEAD_FORM_SUBMISSIONS",
  CompleteRegistration: "PIXEL_SIGNUP",
  Install: "APP_INSTALLS",
};
const SNAP_OBJECTIVES: Record<CreateCampaignAction["payload"]["objective"], string> = {
  purchases: "WEB_CONVERSION",
  leads: "LEAD_GENERATION",
  registrations: "WEB_CONVERSION",
  installs: "APP_INSTALL",
  visits: "WEB_VIEW",
};
const PINTEREST_CONVERSION_EVENTS: Record<string, string> = {
  Purchase: "CHECKOUT",
  InitiateCheckout: "CHECKOUT",
  AddToCart: "ADD_TO_CART",
  ViewContent: "PAGE_VISIT",
  Lead: "LEAD",
  CompleteRegistration: "SIGNUP",
};
const PINTEREST_OBJECTIVES: Record<CreateCampaignAction["payload"]["objective"], string> = {
  purchases: "WEB_CONVERSION",
  leads: "WEB_CONVERSION",
  registrations: "WEB_CONVERSION",
  installs: "WEB_CONVERSION",
  visits: "WEB_SESSIONS",
};
const GOOGLE_CONVERSION_GOALS: Record<string, string> = {
  Purchase: "purchase",
  InitiateCheckout: "begin_checkout",
  AddToCart: "add_to_cart",
  ViewContent: "page_view",
  Lead: "submit_lead_form",
  CompleteRegistration: "sign_up",
  Install: "app_install",
};

// --- Recorded platform schemas (stub validation) ------------------------------
const metaCreateSchema = z
  .object({
    name: z.string(),
    objective: z.string(),
    smart_promotion_type: z.literal("AUTOMATED_SHOPPING_ADS"),
    status: z.literal("PAUSED"),
    special_ad_categories: z.array(z.string()),
    daily_budget: z.number().int().positive(), // minor units
    promoted_object: z.object({ custom_event_type: z.string() }).strict(),
    creative_asset_ids: z.array(z.string()),
    destination_url: z.string().url(),
    content_ids: z.array(z.string()),
  })
  .strict();

const googleCreateSchema = z
  .object({
    campaign: z
      .object({
        name: z.string(),
        advertising_channel_type: z.literal("PERFORMANCE_MAX"),
        status: z.literal("PAUSED"),
        campaign_budget: z.object({ amount_micros: z.number().int().positive() }).strict(),
        bidding_strategy: z.object({ maximize_conversions: z.object({}).strict() }).strict(),
      })
      .strict(),
    asset_group: z
      .object({
        name: z.string(),
        final_urls: z.array(z.string().url()),
        asset_ids: z.array(z.string()),
      })
      .strict(),
    conversion_goal: z.string(),
  })
  .strict();

const tiktokCreateSchema = z
  .object({
    campaign_name: z.string(),
    objective_type: z.string(),
    smart_performance_campaign: z.literal(true),
    operation_status: z.literal("DISABLE"),
    budget_mode: z.literal("BUDGET_MODE_DAY"),
    budget: z.number().positive(),
    optimization_event: z.string(),
    creative_asset_ids: z.array(z.string()),
    landing_page_url: z.string().url(),
    product_ids: z.array(z.string()),
  })
  .strict();

const snapchatCreateSchema = z
  .object({
    name: z.string(),
    status: z.literal("PAUSED"),
    objective: z.string(),
    auto_bid: z.literal(true),
    daily_budget_micro: z.number().int().positive(),
    optimization_goal: z.string(),
    creative_ids: z.array(z.string()),
    web_view_url: z.string().url(),
    item_ids: z.array(z.string()),
    regulated_content: z.boolean(),
  })
  .strict();

const pinterestCreateSchema = z
  .object({
    name: z.string(),
    status: z.literal("PAUSED"),
    objective_type: z.string(),
    is_performance_plus: z.literal(true),
    daily_spend_cap: z.number().int().positive(), // microcurrency
    conversion_event: z.string(),
    creative_ids: z.array(z.string()),
    destination_url: z.string().url(),
    content_ids: z.array(z.string()),
  })
  .strict();

function stubId(platform: Platform, seed: string): string {
  return `stub_${platform}_${createHash("sha256").update(seed).digest("hex").slice(0, 10)}`;
}

function log(platform: Platform, msg: string, extra: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), adapter: platform, msg, ...extra }));
}

export interface PlatformAdapterOptions {
  repos: Repos;
  mode?: DriverMode;
  /** Test fixtures keyed `${platformCampaignId}:${date}`. */
  insightsFixtures?: Record<string, InsightsReport>;
}

function deterministicInsights(platformCampaignId: string, date: string): InsightsReport {
  const h = parseInt(
    createHash("sha256").update(`${platformCampaignId}:${date}`).digest("hex").slice(0, 8),
    16,
  );
  const spend = 50 + (h % 400);
  const impressions = spend * 120;
  const clicks = Math.round(impressions * 0.02);
  const conversions = Math.round(clicks * 0.05);
  return {
    date,
    spend,
    impressions,
    clicks,
    conversions,
    revenue: conversions * 150,
    currency: "AED",
  };
}

function makeAdapter(
  platform: Platform,
  opts: PlatformAdapterOptions,
  buildCreatePayload: (a: CreateCampaignAction) => Record<string, unknown>,
  createSchema: z.ZodTypeAny,
  liveCreate: (payload: Record<string, unknown>) => Promise<string>,
): PlatformAdapter {
  const mode = opts.mode ?? driverMode(`${platform.toUpperCase()}_MODE`);
  const { repos } = opts;

  async function preWrite(action: object): Promise<void> {
    assertApproved(action);
    if (await repos.killSwitch.isEngaged()) {
      throw new Error(`kill switch engaged — ${platform} write refused`);
    }
  }

  return {
    platform,
    mode,
    buildCreatePayload,
    async createCampaign(approved) {
      await preWrite(approved);
      const payload = buildCreatePayload(approved.action);
      if (mode === "stub") {
        createSchema.parse(payload);
        const platformCampaignId = stubId(platform, approved.action.specId);
        log(platform, "stub create_campaign", { payload, platformCampaignId });
        return { platformCampaignId };
      }
      return { platformCampaignId: await liveCreate(payload) };
    },
    async updateCampaign(approved) {
      await preWrite(approved);
      const { platformCampaignId, changes } = approved.action;
      if (mode === "stub") {
        log(platform, "stub update_campaign", { platformCampaignId, changes });
        return;
      }
      throw new Error(`${platform} live update requires P5 credentials (see BLOCKED.md)`);
    },
    async pauseCampaign(approved) {
      await preWrite(approved);
      if (mode === "stub") {
        log(platform, "stub pause_campaign", { id: approved.action.platformCampaignId });
        return;
      }
      throw new Error(`${platform} live pause requires P5 credentials (see BLOCKED.md)`);
    },
    async resumeCampaign(approved) {
      await preWrite(approved);
      if (mode === "stub") {
        log(platform, "stub resume_campaign", { id: approved.action.platformCampaignId });
        return;
      }
      throw new Error(`${platform} live resume requires P5 credentials (see BLOCKED.md)`);
    },
    async duplicateCampaign(approved) {
      await preWrite(approved);
      if (mode === "stub") {
        const platformCampaignId = stubId(
          platform,
          `${approved.action.platformCampaignId}:dup:${approved.action.overrides.name ?? ""}`,
        );
        log(platform, "stub duplicate_campaign", {
          from: approved.action.platformCampaignId,
          platformCampaignId,
        });
        return { platformCampaignId };
      }
      throw new Error(`${platform} live duplicate requires P5 credentials (see BLOCKED.md)`);
    },
    async uploadCreative(approved) {
      await preWrite(approved);
      if (mode === "stub") {
        const platformAssetRef = `stub://uploaded/${platform}/${approved.action.creativeId}`;
        log(platform, "stub upload_creative", { creativeId: approved.action.creativeId });
        return { platformAssetRef };
      }
      throw new Error(`${platform} live upload requires P5 credentials (see BLOCKED.md)`);
    },
    async readInsights(scope, window) {
      const key = `${scope.platformCampaignId}:${window.date}`;
      if (opts.insightsFixtures?.[key]) return opts.insightsFixtures[key];
      if (mode === "stub") return deterministicInsights(scope.platformCampaignId, window.date);
      throw new Error(`${platform} live insights require P5 credentials (see BLOCKED.md)`);
    },
  };
}

export function createMetaPlatform(opts: PlatformAdapterOptions): PlatformAdapter {
  return makeAdapter(
    "meta",
    { ...opts, mode: opts.mode ?? driverMode("META_MODE") },
    (a) => ({
      name: a.payload.name,
      objective: META_OBJECTIVES[a.payload.objective],
      smart_promotion_type: "AUTOMATED_SHOPPING_ADS",
      status: "PAUSED",
      special_ad_categories:
        a.payload.policyCategory === "restricted" ? ["FINANCIAL_PRODUCTS_SERVICES"] : [],
      daily_budget: Math.round(a.payload.dailyBudget * 100),
      promoted_object: { custom_event_type: META_OPT_EVENTS[a.payload.optimizationEvent] ?? "PURCHASE" },
      creative_asset_ids: a.payload.creativeIds,
      destination_url: a.payload.destinationUrl,
      content_ids: a.payload.contentIds,
    }),
    metaCreateSchema,
    async () => {
      throw new Error("meta live create requires P5 credentials (see BLOCKED.md)");
    },
  );
}

export function createGooglePlatform(opts: PlatformAdapterOptions): PlatformAdapter {
  return makeAdapter(
    "google",
    { ...opts, mode: opts.mode ?? driverMode("GOOGLE_MODE") },
    (a) => ({
      campaign: {
        name: a.payload.name,
        advertising_channel_type: "PERFORMANCE_MAX",
        status: "PAUSED",
        campaign_budget: { amount_micros: Math.round(a.payload.dailyBudget * 1_000_000) },
        bidding_strategy: { maximize_conversions: {} },
      },
      asset_group: {
        name: `${a.payload.name} — assets`,
        final_urls: [a.payload.destinationUrl],
        asset_ids: a.payload.creativeIds,
      },
      conversion_goal: GOOGLE_CONVERSION_GOALS[a.payload.optimizationEvent] ?? "purchase",
    }),
    googleCreateSchema,
    async () => {
      throw new Error("google live create requires P5 credentials (see BLOCKED.md)");
    },
  );
}

export function createTikTokPlatform(opts: PlatformAdapterOptions): PlatformAdapter {
  return makeAdapter(
    "tiktok",
    { ...opts, mode: opts.mode ?? driverMode("TIKTOK_MODE") },
    (a) => ({
      campaign_name: a.payload.name,
      objective_type: TIKTOK_OBJECTIVES[a.payload.objective],
      smart_performance_campaign: true,
      operation_status: "DISABLE",
      budget_mode: "BUDGET_MODE_DAY",
      budget: a.payload.dailyBudget,
      optimization_event: TIKTOK_OPT_EVENTS[a.payload.optimizationEvent] ?? "COMPLETE_PAYMENT",
      creative_asset_ids: a.payload.creativeIds,
      landing_page_url: a.payload.destinationUrl,
      product_ids: a.payload.contentIds,
    }),
    tiktokCreateSchema,
    async () => {
      throw new Error("tiktok live create requires P5 credentials (see BLOCKED.md)");
    },
  );
}

export function createSnapchatPlatform(opts: PlatformAdapterOptions): PlatformAdapter {
  return makeAdapter(
    "snapchat",
    { ...opts, mode: opts.mode ?? driverMode("SNAPCHAT_MODE") },
    (a) => ({
      name: a.payload.name,
      status: "PAUSED",
      objective: SNAP_OBJECTIVES[a.payload.objective],
      auto_bid: true,
      daily_budget_micro: Math.round(a.payload.dailyBudget * 1_000_000),
      optimization_goal: SNAP_OPT_EVENTS[a.payload.optimizationEvent] ?? "PIXEL_PURCHASE",
      creative_ids: a.payload.creativeIds,
      web_view_url: a.payload.destinationUrl,
      item_ids: a.payload.contentIds,
      regulated_content: a.payload.policyCategory === "restricted",
    }),
    snapchatCreateSchema,
    async () => {
      throw new Error("snapchat live create requires P5 credentials (see BLOCKED.md)");
    },
  );
}

export function createPinterestPlatform(opts: PlatformAdapterOptions): PlatformAdapter {
  return makeAdapter(
    "pinterest",
    { ...opts, mode: opts.mode ?? driverMode("PINTEREST_MODE") },
    (a) => ({
      name: a.payload.name,
      status: "PAUSED",
      objective_type: PINTEREST_OBJECTIVES[a.payload.objective],
      is_performance_plus: true,
      daily_spend_cap: Math.round(a.payload.dailyBudget * 1_000_000),
      conversion_event: PINTEREST_CONVERSION_EVENTS[a.payload.optimizationEvent] ?? "CHECKOUT",
      creative_ids: a.payload.creativeIds,
      destination_url: a.payload.destinationUrl,
      content_ids: a.payload.contentIds,
    }),
    pinterestCreateSchema,
    async () => {
      throw new Error("pinterest live create requires P5 credentials (see BLOCKED.md)");
    },
  );
}

export function createPlatformAdapters(
  opts: PlatformAdapterOptions,
): Record<Platform, PlatformAdapter> {
  return {
    meta: createMetaPlatform(opts),
    google: createGooglePlatform(opts),
    tiktok: createTikTokPlatform(opts),
    snapchat: createSnapchatPlatform(opts),
    pinterest: createPinterestPlatform(opts),
  };
}
