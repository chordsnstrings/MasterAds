// Full data model per SW §6.1-6.2. Decision and CostEvent are event-sourced,
// insert-only streams (CLAUDE.md invariant 3): immutability is enforced both by
// the repository API (no update/delete exposed) and by DB triggers in migrations.
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Product (SW §6.1) — one row per advertised thing, catalog or offer mode.
// ---------------------------------------------------------------------------
export const products = pgTable("products", {
  id: text("id").primaryKey(),
  mode: text("mode", { enum: ["catalog", "offer"] }).notNull(),
  vertical: text("vertical"),
  sourceRef: text("source_ref"), // url / feed file ref / "text"
  title: text("title").notNull(),
  description: text("description"),
  price: numeric("price", { precision: 14, scale: 4 }),
  currency: text("currency"),
  url: text("url"),
  images: jsonb("images").$type<string[]>().notNull().default([]),
  category: text("category"),
  availability: text("availability", {
    enum: ["in_stock", "out_of_stock", "unknown"],
  })
    .notNull()
    .default("unknown"),
  // UI lifecycle status (UX §7 fixed ordered set + in_review for FLOW §8.6).
  status: text("status", {
    enum: [
      "draft",
      "in_review",
      "launching",
      "learning",
      "autonomous",
      "needs_attention",
      "paused",
    ],
  })
    .notNull()
    .default("draft"),
  // Margin % of revenue (SW §14: value carries margin where supplied).
  marginPct: numeric("margin_pct", { precision: 5, scale: 2 }),
  // Products imported together from one feed share a catalog group (FLOW §7).
  catalogGroupId: text("catalog_group_id"),
  rawInput: text("raw_input"), // offer text kept raw for classification (G5)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Playbook (SW §6.1) — versioned data rows seeded from JSON in-repo (G5).
// ---------------------------------------------------------------------------
export const playbooks = pgTable("playbooks", {
  id: text("id").primaryKey(),
  vertical: text("vertical").notNull(),
  version: integer("version").notNull().default(1),
  objective: text("objective").notNull(),
  funnelEvents: jsonb("funnel_events").$type<string[]>().notNull(),
  creativeAngles: jsonb("creative_angles").$type<string[]>().notNull(),
  formatMix: jsonb("format_mix").$type<string[]>().notNull(),
  audienceStrategy: text("audience_strategy").notNull(),
  complianceConstraints: jsonb("compliance_constraints").$type<string[]>().notNull().default([]),
  performancePriors: jsonb("performance_priors")
    .$type<Record<string, number>>()
    .notNull()
    .default({}),
  status: text("status", { enum: ["active", "draft", "deprecated"] })
    .notNull()
    .default("active"),
  targetPlatforms: jsonb("target_platforms")
    .$type<string[]>()
    .notNull()
    .default(["meta", "google", "tiktok"]),
  // Restricted-category playbooks cannot launch until a one-time human
  // compliance sign-off (SW §10.5, CLAUDE.md invariant 9).
  requiresSignoff: boolean("requires_signoff").notNull().default(false),
  signedOffAt: timestamp("signed_off_at", { withTimezone: true }),
  signedOffBy: text("signed_off_by"),
});

// ---------------------------------------------------------------------------
// CampaignSpec (SW §6.1) — the canonical spec every product maps into.
// ---------------------------------------------------------------------------
export const campaignSpecs = pgTable("campaign_specs", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  playbookId: text("playbook_id").references(() => playbooks.id),
  businessModel: text("business_model", {
    enum: ["ecommerce", "lead_generation", "app", "subscription", "booking"],
  }).notNull(),
  terminalEvent: text("terminal_event").notNull(),
  optimizationEvent: text("optimization_event").notNull(),
  funnelStages: jsonb("funnel_stages").$type<string[]>().notNull(),
  priceTier: text("price_tier", { enum: ["low", "mid", "high", "premium"] }).notNull(),
  creativeAngle: text("creative_angle").notNull(),
  policyCategory: text("policy_category", { enum: ["standard", "restricted"] }).notNull(),
  targetPlatforms: jsonb("target_platforms").$type<string[]>().notNull(),
  audienceStrategy: text("audience_strategy").notNull(),
  formatMix: jsonb("format_mix").$type<string[]>().notNull(),
  // Goal/budget/destination captured in the creation flow (FLOW §4-6).
  goal: text("goal"),
  dailyBudget: numeric("daily_budget", { precision: 14, scale: 4 }),
  budgetCurrency: text("budget_currency"),
  destination: jsonb("destination").$type<{
    kind: "url" | "hosted_page" | "hosted_form" | "whatsapp" | "call";
    value: string;
  }>(),
  // Consolidation grouping for thin-volume products (SW §5.3).
  consolidationGroup: text("consolidation_group"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Creative (SW §6.1)
// ---------------------------------------------------------------------------
export const creatives = pgTable("creatives", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  variantNo: integer("variant_no").notNull(),
  format: text("format", { enum: ["1:1", "9:16", "16:9"] }).notNull(),
  assetType: text("asset_type", { enum: ["image", "video", "copy"] }).notNull(),
  assetRef: text("asset_ref").notNull(),
  // Copy text / brief payload (headline, body, descriptors) per variant.
  payload: jsonb("payload").$type<Record<string, string>>().notNull().default({}),
  contentId: text("content_id").notNull(),
  predictedScore: numeric("predicted_score", { precision: 6, scale: 4 }),
  status: text("status", {
    enum: ["generating", "ready", "held", "launched", "blocked", "expired", "retired"],
  })
    .notNull()
    .default("generating"),
  fatigueState: text("fatigue_state", { enum: ["fresh", "tiring", "fatigued"] })
    .notNull()
    .default("fresh"),
  // Promo-bound creative auto-expires with the promo (G9).
  promoId: text("promo_id"),
  priceBearing: boolean("price_bearing").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Campaign (SW §6.1)
// ---------------------------------------------------------------------------
export const campaigns = pgTable(
  "campaigns",
  {
    id: text("id").primaryKey(),
    specId: text("spec_id")
      .notNull()
      .references(() => campaignSpecs.id),
    platform: text("platform", { enum: ["meta", "google", "tiktok", "snapchat", "pinterest"] }).notNull(),
    platformCampaignId: text("platform_campaign_id"),
    campaignType: text("campaign_type").notNull(),
    objective: text("objective").notNull(),
    optimizationEvent: text("optimization_event").notNull(),
    budget: numeric("budget", { precision: 14, scale: 4 }).notNull(),
    budgetMode: text("budget_mode", { enum: ["daily", "lifetime"] })
      .notNull()
      .default("daily"),
    status: text("status", {
      enum: ["launching", "learning", "autonomous", "needs_attention", "paused", "ended"],
    })
      .notNull()
      .default("launching"),
    learningState: text("learning_state", {
      enum: ["pending", "learning", "exited", "stuck"],
    })
      .notNull()
      .default("pending"),
    // Auto-promotion of allocation authority per slice (SW §9.4 rule 3, G8).
    allocationAutonomous: boolean("allocation_autonomous").notNull().default(false),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Idempotent launch: one campaign per spec+platform (G7).
    uniqueIndex("campaigns_spec_platform_uq").on(t.specId, t.platform),
  ],
);

// ---------------------------------------------------------------------------
// ConversionEvent (SW §6.1, §7.1) — canonical store. Idempotent on
// (source_site, event_id). occurred (event_time) vs received both kept.
// ---------------------------------------------------------------------------
export type ClickIds = {
  fbc?: string;
  fbclid?: string;
  fbp?: string;
  ttclid?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  sccid?: string;
  epik?: string;
};
export type HashedIdentifiers = {
  email_sha256?: string;
  phone_sha256?: string;
  first_name_sha256?: string;
  last_name_sha256?: string;
  city_sha256?: string;
  zip_sha256?: string;
  country_sha256?: string;
  external_id_sha256?: string;
};
export type ClientInfo = { ip?: string; user_agent?: string };
export type ConsentSignals = { ad_user_data?: boolean; ad_personalization?: boolean };
export type RelayRecord = {
  platform: "meta" | "google" | "tiktok" | "snapchat" | "pinterest";
  status: "pending" | "sent" | "failed" | "dead_letter" | "skipped";
  attempts: number;
  lastError?: string;
  at: string;
};

export const conversionEvents = pgTable(
  "conversion_events",
  {
    id: text("id").primaryKey(),
    eventName: text("event_name").notNull(),
    eventTime: timestamp("event_time", { withTimezone: true }).notNull(),
    value: numeric("value", { precision: 14, scale: 4 }),
    currency: text("currency"),
    contentId: text("content_id").notNull(),
    clickIds: jsonb("click_ids").$type<ClickIds>().notNull().default({}),
    hashedIdentifiers: jsonb("hashed_identifiers").$type<HashedIdentifiers>().notNull().default({}),
    eventId: text("event_id").notNull(),
    sourceSite: text("source_site").notNull(),
    consentGranted: boolean("consent_granted").notNull().default(true),
    clientInfo: jsonb("client_info").$type<ClientInfo>().notNull().default({}),
    consentSignals: jsonb("consent_signals").$type<ConsentSignals>().notNull().default({}),
    relayedTo: jsonb("relayed_to").$type<RelayRecord[]>().notNull().default([]),
    dedupKey: text("dedup_key").notNull(),
    // Cross-platform reconciliation (SW §8.5): rows sharing a reconciliation
    // key collapse to one canonical row; non-canonical rows are platform claims.
    reconciliationKey: text("reconciliation_key").notNull(),
    canonical: boolean("canonical").notNull().default(true),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("conversion_events_site_event_uq").on(t.sourceSite, t.eventId),
    index("conversion_events_recon_idx").on(t.reconciliationKey),
    index("conversion_events_content_idx").on(t.contentId),
  ],
);

// ---------------------------------------------------------------------------
// Decision (SW §6.1) — event-sourced, insert-only. Written BEFORE execution.
// Outcomes are recorded as separate insert-only decision_outcomes rows so the
// Decision row itself is never updated (CLAUDE.md invariant 3).
// ---------------------------------------------------------------------------
export const decisions = pgTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    loop: text("loop", { enum: ["fast", "medium", "slow", "system"] }).notNull(),
    worker: text("worker").notNull(),
    actionType: text("action_type").notNull(),
    targetRef: text("target_ref").notNull(),
    rationale: text("rationale").notNull(),
    // Structured evidence for the UI "why" expansion (metric, window, result).
    evidence: jsonb("evidence")
      .$type<{ metric: string; window: string; result: string }[]>()
      .notNull()
      .default([]),
    predictedOutcome: text("predicted_outcome"),
    guardrailStatus: text("guardrail_status", {
      enum: ["passed", "blocked", "escalated"],
    }).notNull(),
    executed: boolean("executed").notNull(),
    productId: text("product_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("decisions_target_idx").on(t.targetRef), index("decisions_product_idx").on(t.productId)],
);

// Insert-only outcome stream filled by the scoring job (G10).
export const decisionOutcomes = pgTable("decision_outcomes", {
  id: text("id").primaryKey(),
  decisionId: text("decision_id")
    .notNull()
    .references(() => decisions.id),
  actualOutcome: text("actual_outcome").notNull(),
  scoredDelta: numeric("scored_delta", { precision: 10, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// CostEvent (SW §6.1) — event-sourced, insert-only. ad_spend from platform
// reporting; ai_inference written inside the calling adapter (invariant 4).
// ---------------------------------------------------------------------------
export const costEvents = pgTable(
  "cost_events",
  {
    id: text("id").primaryKey(),
    costType: text("cost_type", { enum: ["ad_spend", "ai_inference"] }).notNull(),
    operation: text("operation", {
      enum: ["classification", "creative_image", "creative_video", "creative_copy", "narration"],
    }),
    providerOrPlatform: text("provider_or_platform").notNull(),
    model: text("model"),
    units: jsonb("units")
      .$type<{
        input_tokens?: number;
        output_tokens?: number;
        images?: number;
        video_seconds?: number;
      }>()
      .notNull()
      .default({}),
    unitPrice: numeric("unit_price", { precision: 14, scale: 8 }),
    amount: numeric("amount", { precision: 14, scale: 6 }).notNull(),
    currency: text("currency").notNull(),
    productId: text("product_id"),
    campaignId: text("campaign_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("cost_events_product_idx").on(t.productId)],
);

// ---------------------------------------------------------------------------
// System settings incl. the kill switch (SW §13.2; CLAUDE.md invariant 2).
// ---------------------------------------------------------------------------
export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Per-site API keys for the ingestion endpoint, stored hashed (G2).
export const siteKeys = pgTable("site_keys", {
  id: text("id").primaryKey(),
  sourceSite: text("source_site").notNull().unique(),
  keyHash: text("key_hash").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Click-ID coverage snapshots (SW §8.7), computed per site × platform (G2).
export const clickIdCoverage = pgTable(
  "click_id_coverage",
  {
    id: text("id").primaryKey(),
    sourceSite: text("source_site").notNull(),
    platform: text("platform", { enum: ["meta", "google", "tiktok", "snapchat", "pinterest"] }).notNull(),
    coveragePct: numeric("coverage_pct", { precision: 6, scale: 2 }).notNull(),
    eventsTotal: integer("events_total").notNull(),
    eventsWithClickId: integer("events_with_click_id").notNull(),
    windowDays: integer("window_days").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("click_id_coverage_site_idx").on(t.sourceSite, t.platform, t.computedAt)],
);

// Promos are first-class records with end dates (G9): bound creative
// auto-expires with the promo.
export const promos = pgTable(
  "promos",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    label: text("label").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    expired: boolean("expired").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("promos_active_idx").on(t.expired, t.endsAt)],
);

// Ad-account health: token/billing state and platform account age (warm-up).
export const adAccounts = pgTable("ad_accounts", {
  id: text("id").primaryKey(),
  platform: text("platform", { enum: ["meta", "google", "tiktok", "snapchat", "pinterest"] }).notNull().unique(),
  accountRef: text("account_ref"),
  platformCreatedAt: timestamp("platform_created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  tokenValid: boolean("token_valid").notNull().default(true),
  billingOk: boolean("billing_ok").notNull().default(true),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
});

export type Promo = typeof promos.$inferSelect;
export type NewPromo = typeof promos.$inferInsert;
export type AdAccount = typeof adAccounts.$inferSelect;

// Daily campaign insights from platform reporting (G7).
export const campaignInsights = pgTable(
  "campaign_insights",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    date: text("date").notNull(),
    spend: numeric("spend", { precision: 14, scale: 4 }).notNull(),
    impressions: integer("impressions").notNull(),
    clicks: integer("clicks").notNull(),
    conversions: integer("conversions").notNull(),
    revenue: numeric("revenue", { precision: 14, scale: 4 }).notNull().default("0"),
    currency: text("currency").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("campaign_insights_day_uq").on(t.campaignId, t.date)],
);

export type CampaignInsight = typeof campaignInsights.$inferSelect;
export type NewCampaignInsight = typeof campaignInsights.$inferInsert;

// Intake jobs: async "reading…" status polled by the creation flow UI (G4).
export const intakeJobs = pgTable("intake_jobs", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["url", "text", "file"] }).notNull(),
  input: text("input").notNull(),
  status: text("status", { enum: ["reading", "done", "unreadable"] })
    .notNull()
    .default("reading"),
  result: jsonb("result").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Connected feeds re-pulled on a 4-6h cadence (SW §5.1).
export const feedSources = pgTable("feed_sources", {
  id: text("id").primaryKey(),
  ref: text("ref").notNull(),
  label: text("label"),
  catalogGroupId: text("catalog_group_id").notNull(),
  syncIntervalHours: integer("sync_interval_hours").notNull().default(4),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Typed change events from feed diffs (G4), consumed by G9 automations.
export const productChangeEvents = pgTable(
  "product_change_events",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull(),
    changeType: text("change_type", {
      enum: ["price_change", "stock_out", "back_in_stock", "new_product"],
    }).notNull(),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    processed: boolean("processed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("product_change_unprocessed_idx").on(t.processed, t.createdAt)],
);

export type IntakeJob = typeof intakeJobs.$inferSelect;
export type FeedSource = typeof feedSources.$inferSelect;
export type NewFeedSource = typeof feedSources.$inferInsert;
export type ProductChangeEvent = typeof productChangeEvents.$inferSelect;
export type NewProductChangeEvent = typeof productChangeEvents.$inferInsert;

// Attention records (UX §7): what happened + one clear fix; raised by workers.
export const attentionRecords = pgTable(
  "attention_records",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    severity: text("severity", { enum: ["warning", "approval", "error"] })
      .notNull()
      .default("warning"),
    message: text("message").notNull(),
    fixHint: text("fix_hint"),
    targetRef: text("target_ref"),
    status: text("status", { enum: ["open", "resolved"] })
      .notNull()
      .default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("attention_open_idx").on(t.status, t.createdAt)],
);

export type AttentionRecord = typeof attentionRecords.$inferSelect;
export type NewAttentionRecord = typeof attentionRecords.$inferInsert;

export type CoverageSnapshot = typeof clickIdCoverage.$inferSelect;
export type NewCoverageSnapshot = typeof clickIdCoverage.$inferInsert;

// Incrementality experiments (W3.5): geo holdouts, the causal calibration seam.
export const experiments = pgTable("experiments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["geo_holdout"] }).notNull().default("geo_holdout"),
  platform: text("platform"),
  testRegion: text("test_region").notNull(),
  controlRegion: text("control_region").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  status: text("status", { enum: ["planned", "running", "complete"] })
    .notNull()
    .default("planned"),
  readout: jsonb("readout").$type<{
    test_conversions?: number;
    control_conversions?: number;
    lift_pct?: number;
    incremental_return?: number;
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Experiment = typeof experiments.$inferSelect;
export type NewExperiment = typeof experiments.$inferInsert;

// Per-site signal-strength snapshots (W2): EMQ-style identifier richness.
export const signalQuality = pgTable(
  "signal_quality",
  {
    id: text("id").primaryKey(),
    sourceSite: text("source_site").notNull(),
    avgScore: numeric("avg_score", { precision: 5, scale: 2 }).notNull(),
    eventsTotal: integer("events_total").notNull(),
    windowDays: integer("window_days").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("signal_quality_site_idx").on(t.sourceSite, t.computedAt)],
);
export type SignalSnapshot = typeof signalQuality.$inferSelect;
export type NewSignalSnapshot = typeof signalQuality.$inferInsert;

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Playbook = typeof playbooks.$inferSelect;
export type NewPlaybook = typeof playbooks.$inferInsert;
export type CampaignSpec = typeof campaignSpecs.$inferSelect;
export type NewCampaignSpec = typeof campaignSpecs.$inferInsert;
export type Creative = typeof creatives.$inferSelect;
export type NewCreative = typeof creatives.$inferInsert;
export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type ConversionEvent = typeof conversionEvents.$inferSelect;
export type NewConversionEvent = typeof conversionEvents.$inferInsert;
export type Decision = typeof decisions.$inferSelect;
export type NewDecision = typeof decisions.$inferInsert;
export type DecisionOutcome = typeof decisionOutcomes.$inferSelect;
export type NewDecisionOutcome = typeof decisionOutcomes.$inferInsert;
export type CostEvent = typeof costEvents.$inferSelect;
export type NewCostEvent = typeof costEvents.$inferInsert;
export type SiteKey = typeof siteKeys.$inferSelect;
