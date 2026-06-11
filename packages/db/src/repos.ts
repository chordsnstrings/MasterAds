// Typed repository layer. Decision, DecisionOutcome and CostEvent repositories
// expose insert and select ONLY — immutability by construction (invariant 3),
// backed by DB triggers from migration 0001.
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type { Db } from "./client.js";
import {
  adAccounts,
  attentionRecords,
  campaignInsights,
  campaignSpecs,
  campaigns,
  clickIdCoverage,
  conversionEvents,
  costEvents,
  creatives,
  decisionOutcomes,
  decisions,
  experiments,
  feedSources,
  intakeJobs,
  notifications,
  platformConnections,
  playbooks,
  productChangeEvents,
  promos,
  products,
  signalQuality,
  siteKeys,
  systemSettings,
  type AdAccount,
  type Campaign,
  type CampaignInsight,
  type CampaignSpec,
  type ConversionEvent,
  type CostEvent,
  type Creative,
  type Decision,
  type DecisionOutcome,
  type AttentionRecord,
  type CoverageSnapshot,
  type NewAttentionRecord,
  type NewCampaign,
  type NewCampaignInsight,
  type FeedSource,
  type IntakeJob,
  type NewCoverageSnapshot,
  type NewFeedSource,
  type NewProductChangeEvent,
  type ProductChangeEvent,
  type NewCampaignSpec,
  type NewConversionEvent,
  type NewCostEvent,
  type NewCreative,
  type NewDecision,
  type NewPlaybook,
  type NewProduct,
  type NewPromo,
  type Playbook,
  type Experiment,
  type NewExperiment,
  type NewSignalSnapshot,
  type NewNotification,
  type Notification,
  type PlatformConnection,
  type Promo,
  type Product,
  type SignalSnapshot,
  type RelayRecord,
} from "./schema.js";

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function hashSiteKey(rawKey: string): string {
  const salt = process.env.SITE_KEY_SALT ?? "dev-salt";
  return createHash("sha256").update(`${salt}:${rawKey}`).digest("hex");
}

export function createRepos(db: Db) {
  return {
    products: {
      async insert(row: Omit<NewProduct, "id"> & { id?: string }): Promise<Product> {
        const id = row.id ?? newId("prod");
        const [r] = await db.insert(products).values({ ...row, id }).returning();
        if (!r) throw new Error("insert failed");
        return r;
      },
      async update(
        id: string,
        patch: Partial<
          Pick<
            NewProduct,
            | "title"
            | "description"
            | "price"
            | "currency"
            | "availability"
            | "status"
            | "vertical"
            | "category"
            | "images"
            | "url"
            | "marginPct"
          >
        >,
      ): Promise<Product> {
        const [r] = await db
          .update(products)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(products.id, id))
          .returning();
        if (!r) throw new Error(`product ${id} not found`);
        return r;
      },
      async get(id: string): Promise<Product | undefined> {
        return (await db.select().from(products).where(eq(products.id, id)))[0];
      },
      async list(): Promise<Product[]> {
        return db.select().from(products).orderBy(desc(products.createdAt));
      },
      async byCatalogGroup(groupId: string): Promise<Product[]> {
        return db.select().from(products).where(eq(products.catalogGroupId, groupId));
      },
    },

    playbooks: {
      async insert(row: Omit<NewPlaybook, "id"> & { id?: string }): Promise<Playbook> {
        const id = row.id ?? newId("pb");
        const [r] = await db.insert(playbooks).values({ ...row, id }).returning();
        if (!r) throw new Error("insert failed");
        return r;
      },
      async upsertByVertical(row: Omit<NewPlaybook, "id"> & { id?: string }): Promise<Playbook> {
        const existing = (
          await db.select().from(playbooks).where(eq(playbooks.vertical, row.vertical))
        )[0];
        if (existing) return existing;
        return this.insert(row);
      },
      async get(id: string): Promise<Playbook | undefined> {
        return (await db.select().from(playbooks).where(eq(playbooks.id, id)))[0];
      },
      async byVertical(vertical: string): Promise<Playbook | undefined> {
        return (
          await db
            .select()
            .from(playbooks)
            .where(and(eq(playbooks.vertical, vertical), eq(playbooks.status, "active")))
        )[0];
      },
      async list(): Promise<Playbook[]> {
        return db.select().from(playbooks);
      },
      async updatePriors(id: string, priors: Record<string, number>): Promise<void> {
        await db.update(playbooks).set({ performancePriors: priors }).where(eq(playbooks.id, id));
      },
      async signOff(id: string, by: string): Promise<Playbook> {
        const [r] = await db
          .update(playbooks)
          .set({ signedOffAt: new Date(), signedOffBy: by })
          .where(eq(playbooks.id, id))
          .returning();
        if (!r) throw new Error(`playbook ${id} not found`);
        return r;
      },
    },

    specs: {
      async insert(row: Omit<NewCampaignSpec, "id"> & { id?: string }): Promise<CampaignSpec> {
        const id = row.id ?? newId("spec");
        const [r] = await db.insert(campaignSpecs).values({ ...row, id }).returning();
        if (!r) throw new Error("insert failed");
        return r;
      },
      async get(id: string): Promise<CampaignSpec | undefined> {
        return (await db.select().from(campaignSpecs).where(eq(campaignSpecs.id, id)))[0];
      },
      async byProduct(productId: string): Promise<CampaignSpec | undefined> {
        return (
          await db
            .select()
            .from(campaignSpecs)
            .where(eq(campaignSpecs.productId, productId))
            .orderBy(desc(campaignSpecs.createdAt))
        )[0];
      },
      async update(
        id: string,
        patch: Partial<
          Pick<
            NewCampaignSpec,
            "goal" | "dailyBudget" | "budgetCurrency" | "destination" | "optimizationEvent" | "targetPlatforms"
          >
        >,
      ): Promise<CampaignSpec> {
        const [r] = await db
          .update(campaignSpecs)
          .set(patch)
          .where(eq(campaignSpecs.id, id))
          .returning();
        if (!r) throw new Error(`spec ${id} not found`);
        return r;
      },
    },

    creatives: {
      async insert(row: Omit<NewCreative, "id"> & { id?: string }): Promise<Creative> {
        const id = row.id ?? newId("cr");
        const [r] = await db.insert(creatives).values({ ...row, id }).returning();
        if (!r) throw new Error("insert failed");
        return r;
      },
      async byProduct(productId: string): Promise<Creative[]> {
        return db
          .select()
          .from(creatives)
          .where(eq(creatives.productId, productId))
          .orderBy(creatives.variantNo);
      },
      async get(id: string): Promise<Creative | undefined> {
        return (await db.select().from(creatives).where(eq(creatives.id, id)))[0];
      },
      async setStatus(id: string, status: Creative["status"]): Promise<void> {
        await db.update(creatives).set({ status }).where(eq(creatives.id, id));
      },
      async updatePayload(id: string, patch: Record<string, string>): Promise<void> {
        const existing = (await db.select().from(creatives).where(eq(creatives.id, id)))[0];
        if (!existing) throw new Error(`creative ${id} not found`);
        await db
          .update(creatives)
          .set({ payload: { ...existing.payload, ...patch } })
          .where(eq(creatives.id, id));
      },
      async setFatigue(id: string, fatigueState: Creative["fatigueState"]): Promise<void> {
        await db.update(creatives).set({ fatigueState }).where(eq(creatives.id, id));
      },
      async countByProductSince(productId: string, since: Date): Promise<number> {
        const rows = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(creatives)
          .where(and(eq(creatives.productId, productId), gte(creatives.createdAt, since)));
        return rows[0]?.n ?? 0;
      },
    },

    campaigns: {
      async insertIdempotent(row: Omit<NewCampaign, "id"> & { id?: string }): Promise<Campaign> {
        const id = row.id ?? newId("camp");
        const [inserted] = await db
          .insert(campaigns)
          .values({ ...row, id })
          .onConflictDoNothing({ target: [campaigns.specId, campaigns.platform] })
          .returning();
        if (inserted) return inserted;
        const existing = (
          await db
            .select()
            .from(campaigns)
            .where(and(eq(campaigns.specId, row.specId), eq(campaigns.platform, row.platform)))
        )[0];
        if (!existing) throw new Error("campaign upsert race");
        return existing;
      },
      async get(id: string): Promise<Campaign | undefined> {
        return (await db.select().from(campaigns).where(eq(campaigns.id, id)))[0];
      },
      async bySpec(specId: string): Promise<Campaign[]> {
        return db.select().from(campaigns).where(eq(campaigns.specId, specId));
      },
      async list(): Promise<Campaign[]> {
        return db.select().from(campaigns);
      },
      async listActive(): Promise<Campaign[]> {
        return db
          .select()
          .from(campaigns)
          .where(inArray(campaigns.status, ["launching", "learning", "autonomous"]));
      },
      async update(
        id: string,
        patch: Partial<
          Pick<
            NewCampaign,
            | "platformCampaignId"
            | "budget"
            | "status"
            | "learningState"
            | "allocationAutonomous"
            | "promotedAt"
            | "optimizationEvent"
          >
        >,
      ): Promise<Campaign> {
        const [r] = await db.update(campaigns).set(patch).where(eq(campaigns.id, id)).returning();
        if (!r) throw new Error(`campaign ${id} not found`);
        return r;
      },
    },

    conversions: {
      /** Idempotent on (source_site, event_id): replays return the existing row. */
      async insertIdempotent(
        row: Omit<NewConversionEvent, "id"> & { id?: string },
      ): Promise<{ event: ConversionEvent; duplicate: boolean }> {
        const id = row.id ?? newId("evt");
        const [inserted] = await db
          .insert(conversionEvents)
          .values({ ...row, id })
          .onConflictDoNothing({
            target: [conversionEvents.sourceSite, conversionEvents.eventId],
          })
          .returning();
        if (inserted) return { event: inserted, duplicate: false };
        const existing = (
          await db
            .select()
            .from(conversionEvents)
            .where(
              and(
                eq(conversionEvents.sourceSite, row.sourceSite),
                eq(conversionEvents.eventId, row.eventId),
              ),
            )
        )[0];
        if (!existing) throw new Error("conversion upsert race");
        return { event: existing, duplicate: true };
      },
      async get(id: string): Promise<ConversionEvent | undefined> {
        return (await db.select().from(conversionEvents).where(eq(conversionEvents.id, id)))[0];
      },
      async byReconciliationKey(key: string): Promise<ConversionEvent[]> {
        return db
          .select()
          .from(conversionEvents)
          .where(eq(conversionEvents.reconciliationKey, key));
      },
      async setRelayedTo(id: string, relayedTo: RelayRecord[]): Promise<void> {
        await db.update(conversionEvents).set({ relayedTo }).where(eq(conversionEvents.id, id));
      },
      async listWindow(from: Date, to: Date): Promise<ConversionEvent[]> {
        return db
          .select()
          .from(conversionEvents)
          .where(and(gte(conversionEvents.receivedAt, from), lte(conversionEvents.receivedAt, to)));
      },
      async listCanonicalSince(since: Date): Promise<ConversionEvent[]> {
        return db
          .select()
          .from(conversionEvents)
          .where(and(eq(conversionEvents.canonical, true), gte(conversionEvents.eventTime, since)));
      },
      async listAll(): Promise<ConversionEvent[]> {
        return db.select().from(conversionEvents).orderBy(desc(conversionEvents.receivedAt));
      },
    },

    // INSERT-ONLY: no update or delete methods exist, by design.
    decisions: {
      async insert(row: Omit<NewDecision, "id"> & { id?: string }): Promise<Decision> {
        const id = row.id ?? newId("dec");
        const [r] = await db.insert(decisions).values({ ...row, id }).returning();
        if (!r) throw new Error("insert failed");
        return r;
      },
      async get(id: string): Promise<Decision | undefined> {
        return (await db.select().from(decisions).where(eq(decisions.id, id)))[0];
      },
      async list(filter?: {
        loop?: Decision["loop"];
        productId?: string;
        actionType?: string;
        limit?: number;
      }): Promise<Decision[]> {
        const conds = [];
        if (filter?.loop) conds.push(eq(decisions.loop, filter.loop));
        if (filter?.productId) conds.push(eq(decisions.productId, filter.productId));
        if (filter?.actionType) conds.push(eq(decisions.actionType, filter.actionType));
        return db
          .select()
          .from(decisions)
          .where(conds.length > 0 ? and(...conds) : undefined)
          .orderBy(desc(decisions.createdAt))
          .limit(filter?.limit ?? 200);
      },
      async insertOutcome(
        row: Omit<DecisionOutcome, "id" | "createdAt"> & { id?: string },
      ): Promise<DecisionOutcome> {
        const id = row.id ?? newId("dout");
        const [r] = await db.insert(decisionOutcomes).values({ ...row, id }).returning();
        if (!r) throw new Error("insert failed");
        return r;
      },
      async listUnscoredExecuted(olderThan: Date): Promise<Decision[]> {
        return db
          .select({ d: decisions })
          .from(decisions)
          .leftJoin(decisionOutcomes, eq(decisionOutcomes.decisionId, decisions.id))
          .where(
            and(
              eq(decisions.executed, true),
              isNull(decisionOutcomes.id),
              lte(decisions.createdAt, olderThan),
            ),
          )
          .then((rows) => rows.map((r) => r.d));
      },
      async outcomesFor(decisionId: string): Promise<DecisionOutcome[]> {
        return db
          .select()
          .from(decisionOutcomes)
          .where(eq(decisionOutcomes.decisionId, decisionId));
      },
    },

    // INSERT-ONLY: no update or delete methods exist, by design.
    costs: {
      async insert(row: Omit<NewCostEvent, "id"> & { id?: string }): Promise<CostEvent> {
        const id = row.id ?? newId("cost");
        const [r] = await db.insert(costEvents).values({ ...row, id }).returning();
        if (!r) throw new Error("insert failed");
        return r;
      },
      async list(filter?: { productId?: string; costType?: CostEvent["costType"] }): Promise<
        CostEvent[]
      > {
        const conds = [];
        if (filter?.productId) conds.push(eq(costEvents.productId, filter.productId));
        if (filter?.costType) conds.push(eq(costEvents.costType, filter.costType));
        return db
          .select()
          .from(costEvents)
          .where(conds.length > 0 ? and(...conds) : undefined)
          .orderBy(desc(costEvents.occurredAt));
      },
      /** Total cost by product over a window: { ad_spend, ai_inference }. */
      async sumsByProduct(
        productId: string,
        since: Date,
      ): Promise<{ adSpend: number; operatingCost: number }> {
        const rows = await db
          .select({
            costType: costEvents.costType,
            total: sql<string>`coalesce(sum(${costEvents.amount}), 0)`,
          })
          .from(costEvents)
          .where(and(eq(costEvents.productId, productId), gte(costEvents.occurredAt, since)))
          .groupBy(costEvents.costType);
        let adSpend = 0;
        let operatingCost = 0;
        for (const r of rows) {
          if (r.costType === "ad_spend") adSpend = Number(r.total);
          else operatingCost = Number(r.total);
        }
        return { adSpend, operatingCost };
      },
      async globalSums(since: Date): Promise<{ adSpend: number; operatingCost: number }> {
        const rows = await db
          .select({
            costType: costEvents.costType,
            total: sql<string>`coalesce(sum(${costEvents.amount}), 0)`,
          })
          .from(costEvents)
          .where(gte(costEvents.occurredAt, since))
          .groupBy(costEvents.costType);
        let adSpend = 0;
        let operatingCost = 0;
        for (const r of rows) {
          if (r.costType === "ad_spend") adSpend = Number(r.total);
          else operatingCost = Number(r.total);
        }
        return { adSpend, operatingCost };
      },
    },

    promos: {
      async create(row: Omit<NewPromo, "id"> & { id?: string }): Promise<Promo> {
        const id = row.id ?? newId("promo");
        const [r] = await db.insert(promos).values({ ...row, id }).returning();
        if (!r) throw new Error("insert failed");
        return r;
      },
      async listExpiring(now: Date): Promise<Promo[]> {
        return db
          .select()
          .from(promos)
          .where(and(eq(promos.expired, false), lte(promos.endsAt, now)));
      },
      async markExpired(id: string): Promise<void> {
        await db.update(promos).set({ expired: true }).where(eq(promos.id, id));
      },
      async byProduct(productId: string): Promise<Promo[]> {
        return db.select().from(promos).where(eq(promos.productId, productId));
      },
    },

    platformConnections: {
      async upsert(
        platform: "meta" | "google" | "tiktok" | "snapchat" | "pinterest",
        credentials: Record<string, string>,
        adAccountRef?: string,
      ): Promise<PlatformConnection> {
        const existing = (
          await db.select().from(platformConnections).where(eq(platformConnections.platform, platform))
        )[0];
        if (existing) {
          const [r] = await db
            .update(platformConnections)
            .set({
              credentials: { ...existing.credentials, ...credentials },
              adAccountRef: adAccountRef ?? existing.adAccountRef,
              updatedAt: new Date(),
            })
            .where(eq(platformConnections.platform, platform))
            .returning();
          return r!;
        }
        const [r] = await db
          .insert(platformConnections)
          .values({ id: newId("conn"), platform, credentials, adAccountRef })
          .returning();
        return r!;
      },
      async get(
        platform: "meta" | "google" | "tiktok" | "snapchat" | "pinterest",
      ): Promise<PlatformConnection | undefined> {
        return (
          await db.select().from(platformConnections).where(eq(platformConnections.platform, platform))
        )[0];
      },
      async list(): Promise<PlatformConnection[]> {
        return db.select().from(platformConnections);
      },
    },

    adAccounts: {
      async upsert(
        platform: "meta" | "google" | "tiktok" | "snapchat" | "pinterest",
        patch: Partial<Pick<AdAccount, "accountRef" | "tokenValid" | "billingOk" | "platformCreatedAt">>,
      ): Promise<AdAccount> {
        const existing = (
          await db.select().from(adAccounts).where(eq(adAccounts.platform, platform))
        )[0];
        if (existing) {
          const [r] = await db
            .update(adAccounts)
            .set({ ...patch, lastCheckedAt: new Date() })
            .where(eq(adAccounts.platform, platform))
            .returning();
          return r!;
        }
        const [r] = await db
          .insert(adAccounts)
          .values({ id: newId("acct"), platform, ...patch, lastCheckedAt: new Date() })
          .returning();
        return r!;
      },
      async get(platform: "meta" | "google" | "tiktok" | "snapchat" | "pinterest"): Promise<AdAccount | undefined> {
        return (await db.select().from(adAccounts).where(eq(adAccounts.platform, platform)))[0];
      },
      async list(): Promise<AdAccount[]> {
        return db.select().from(adAccounts);
      },
    },

    insights: {
      /** Idempotent per (campaign, date): returns whether a row was created. */
      async insertIdempotent(
        row: Omit<NewCampaignInsight, "id"> & { id?: string },
      ): Promise<{ insight: CampaignInsight; inserted: boolean }> {
        const id = row.id ?? newId("ins");
        const [inserted] = await db
          .insert(campaignInsights)
          .values({ ...row, id })
          .onConflictDoNothing({ target: [campaignInsights.campaignId, campaignInsights.date] })
          .returning();
        if (inserted) return { insight: inserted, inserted: true };
        const existing = (
          await db
            .select()
            .from(campaignInsights)
            .where(
              and(
                eq(campaignInsights.campaignId, row.campaignId),
                eq(campaignInsights.date, row.date),
              ),
            )
        )[0];
        if (!existing) throw new Error("insights upsert race");
        return { insight: existing, inserted: false };
      },
      async byCampaign(campaignId: string): Promise<CampaignInsight[]> {
        return db
          .select()
          .from(campaignInsights)
          .where(eq(campaignInsights.campaignId, campaignId))
          .orderBy(campaignInsights.date);
      },
      async since(date: string): Promise<CampaignInsight[]> {
        return db.select().from(campaignInsights).where(gte(campaignInsights.date, date));
      },
    },

    intakeJobs: {
      async create(kind: IntakeJob["kind"], input: string): Promise<IntakeJob> {
        const [r] = await db
          .insert(intakeJobs)
          .values({ id: newId("intake"), kind, input })
          .returning();
        if (!r) throw new Error("insert failed");
        return r;
      },
      async complete(
        id: string,
        status: "done" | "unreadable",
        result: Record<string, unknown>,
      ): Promise<void> {
        await db
          .update(intakeJobs)
          .set({ status, result, updatedAt: new Date() })
          .where(eq(intakeJobs.id, id));
      },
      async get(id: string): Promise<IntakeJob | undefined> {
        return (await db.select().from(intakeJobs).where(eq(intakeJobs.id, id)))[0];
      },
    },

    feeds: {
      async create(row: Omit<NewFeedSource, "id"> & { id?: string }): Promise<FeedSource> {
        const id = row.id ?? newId("feed");
        const [r] = await db.insert(feedSources).values({ ...row, id }).returning();
        if (!r) throw new Error("insert failed");
        return r;
      },
      async list(): Promise<FeedSource[]> {
        return db.select().from(feedSources);
      },
      async due(now: Date): Promise<FeedSource[]> {
        const all = await db.select().from(feedSources);
        return all.filter(
          (f) =>
            !f.lastSyncedAt ||
            now.getTime() - f.lastSyncedAt.getTime() >= f.syncIntervalHours * 3_600_000,
        );
      },
      async markSynced(id: string, at: Date): Promise<void> {
        await db.update(feedSources).set({ lastSyncedAt: at }).where(eq(feedSources.id, id));
      },
    },

    productChanges: {
      async insert(
        row: Omit<NewProductChangeEvent, "id"> & { id?: string },
      ): Promise<ProductChangeEvent> {
        const id = row.id ?? newId("chg");
        const [r] = await db.insert(productChangeEvents).values({ ...row, id }).returning();
        if (!r) throw new Error("insert failed");
        return r;
      },
      async listUnprocessed(): Promise<ProductChangeEvent[]> {
        return db
          .select()
          .from(productChangeEvents)
          .where(eq(productChangeEvents.processed, false))
          .orderBy(productChangeEvents.createdAt);
      },
      async markProcessed(id: string): Promise<void> {
        await db
          .update(productChangeEvents)
          .set({ processed: true })
          .where(eq(productChangeEvents.id, id));
      },
    },

    attention: {
      /** Raise an attention item; deduped on (kind, target_ref) while open. */
      async raise(
        row: Omit<NewAttentionRecord, "id" | "status"> & { id?: string },
      ): Promise<AttentionRecord> {
        const conds = [eq(attentionRecords.status, "open"), eq(attentionRecords.kind, row.kind)];
        if (row.targetRef) conds.push(eq(attentionRecords.targetRef, row.targetRef));
        const existing = (
          await db
            .select()
            .from(attentionRecords)
            .where(and(...conds))
        )[0];
        if (existing) return existing;
        const id = row.id ?? newId("att");
        const [r] = await db
          .insert(attentionRecords)
          .values({ ...row, id, status: "open" })
          .returning();
        if (!r) throw new Error("insert failed");
        return r;
      },
      async resolve(id: string): Promise<void> {
        await db
          .update(attentionRecords)
          .set({ status: "resolved", resolvedAt: new Date() })
          .where(eq(attentionRecords.id, id));
      },
      async listOpen(): Promise<AttentionRecord[]> {
        return db
          .select()
          .from(attentionRecords)
          .where(eq(attentionRecords.status, "open"))
          .orderBy(desc(attentionRecords.createdAt));
      },
    },

    notifications: {
      /** Queue an email; deduped on dedup_key so repeats are no-ops. */
      async queue(
        row: Omit<NewNotification, "id" | "status"> & { id?: string },
      ): Promise<Notification | undefined> {
        const id = row.id ?? newId("ntf");
        const [r] = await db
          .insert(notifications)
          .values({ ...row, id, status: "pending" })
          .onConflictDoNothing({ target: notifications.dedupKey })
          .returning();
        return r;
      },
      async listPending(): Promise<Notification[]> {
        return db
          .select()
          .from(notifications)
          .where(eq(notifications.status, "pending"))
          .orderBy(notifications.createdAt);
      },
      async markSent(id: string): Promise<void> {
        await db
          .update(notifications)
          .set({ status: "sent", sentAt: new Date(), attempts: sql`${notifications.attempts} + 1` })
          .where(eq(notifications.id, id));
      },
      async markFailed(id: string, error: string): Promise<void> {
        await db
          .update(notifications)
          .set({ status: "failed", lastError: error, attempts: sql`${notifications.attempts} + 1` })
          .where(eq(notifications.id, id));
      },
      async list(): Promise<Notification[]> {
        return db.select().from(notifications).orderBy(desc(notifications.createdAt));
      },
    },

    experiments: {
      async create(row: Omit<NewExperiment, "id"> & { id?: string }): Promise<Experiment> {
        const id = row.id ?? newId("exp");
        const [r] = await db.insert(experiments).values({ ...row, id }).returning();
        if (!r) throw new Error("insert failed");
        return r;
      },
      async list(): Promise<Experiment[]> {
        return db.select().from(experiments).orderBy(desc(experiments.createdAt));
      },
      async get(id: string): Promise<Experiment | undefined> {
        return (await db.select().from(experiments).where(eq(experiments.id, id)))[0];
      },
      async complete(id: string, readout: NonNullable<Experiment["readout"]>): Promise<Experiment> {
        const [r] = await db
          .update(experiments)
          .set({ status: "complete", readout })
          .where(eq(experiments.id, id))
          .returning();
        if (!r) throw new Error(`experiment ${id} not found`);
        return r;
      },
      async setStatus(id: string, status: Experiment["status"]): Promise<void> {
        await db.update(experiments).set({ status }).where(eq(experiments.id, id));
      },
      async latestCompleted(): Promise<Experiment | undefined> {
        const rows = await db
          .select()
          .from(experiments)
          .where(eq(experiments.status, "complete"))
          .orderBy(desc(experiments.createdAt))
          .limit(1);
        return rows[0];
      },
    },

    signalQuality: {
      async insert(row: Omit<NewSignalSnapshot, "id"> & { id?: string }): Promise<SignalSnapshot> {
        const id = row.id ?? newId("sig");
        const [r] = await db.insert(signalQuality).values({ ...row, id }).returning();
        if (!r) throw new Error("insert failed");
        return r;
      },
      /** Latest snapshot per source site. */
      async latest(): Promise<SignalSnapshot[]> {
        const rows = await db
          .select()
          .from(signalQuality)
          .orderBy(desc(signalQuality.computedAt))
          .limit(200);
        const seen = new Set<string>();
        const out: SignalSnapshot[] = [];
        for (const r of rows) {
          if (!seen.has(r.sourceSite)) {
            seen.add(r.sourceSite);
            out.push(r);
          }
        }
        return out;
      },
    },

    coverage: {
      async insert(
        row: Omit<NewCoverageSnapshot, "id"> & { id?: string },
      ): Promise<CoverageSnapshot> {
        const id = row.id ?? newId("cov");
        const [r] = await db.insert(clickIdCoverage).values({ ...row, id }).returning();
        if (!r) throw new Error("insert failed");
        return r;
      },
      /** Latest snapshot per (source_site, platform). */
      async latest(): Promise<CoverageSnapshot[]> {
        const rows = await db
          .select()
          .from(clickIdCoverage)
          .orderBy(desc(clickIdCoverage.computedAt))
          .limit(500);
        const seen = new Set<string>();
        const out: CoverageSnapshot[] = [];
        for (const r of rows) {
          const k = `${r.sourceSite}:${r.platform}`;
          if (!seen.has(k)) {
            seen.add(k);
            out.push(r);
          }
        }
        return out;
      },
    },

    settings: {
      async get<T extends Record<string, unknown>>(key: string): Promise<T | undefined> {
        const row = (
          await db.select().from(systemSettings).where(eq(systemSettings.key, key))
        )[0];
        return row?.value as T | undefined;
      },
      async set(key: string, value: Record<string, unknown>): Promise<void> {
        await db
          .insert(systemSettings)
          .values({ key, value, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: systemSettings.key,
            set: { value, updatedAt: new Date() },
          });
      },
    },

    killSwitch: {
      /** Checked at the top of every worker iteration and before every adapter write. */
      async isEngaged(): Promise<boolean> {
        const row = (
          await db.select().from(systemSettings).where(eq(systemSettings.key, "kill_switch"))
        )[0];
        return Boolean((row?.value as { engaged?: boolean } | undefined)?.engaged);
      },
      async set(engaged: boolean): Promise<void> {
        await db
          .insert(systemSettings)
          .values({ key: "kill_switch", value: { engaged }, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: systemSettings.key,
            set: { value: { engaged }, updatedAt: new Date() },
          });
      },
    },

    siteKeys: {
      async create(sourceSite: string, rawKey: string, label?: string): Promise<void> {
        await db
          .insert(siteKeys)
          .values({ id: newId("sk"), sourceSite, keyHash: hashSiteKey(rawKey), label })
          .onConflictDoUpdate({
            target: siteKeys.sourceSite,
            set: { keyHash: hashSiteKey(rawKey), label },
          });
      },
      async list(): Promise<{ sourceSite: string; label: string | null; createdAt: Date }[]> {
        const rows = await db.select().from(siteKeys).orderBy(desc(siteKeys.createdAt));
        return rows.map((r) => ({ sourceSite: r.sourceSite, label: r.label, createdAt: r.createdAt }));
      },
      async verify(sourceSite: string, rawKey: string): Promise<boolean> {
        const row = (
          await db.select().from(siteKeys).where(eq(siteKeys.sourceSite, sourceSite))
        )[0];
        return row !== undefined && row.keyHash === hashSiteKey(rawKey);
      },
    },
  };
}

export type Repos = ReturnType<typeof createRepos>;
