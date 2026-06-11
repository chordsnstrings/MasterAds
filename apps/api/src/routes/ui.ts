// Internal endpoints backing the supervision UI (UX §6). All mutations from
// the UI flow through the same guardrail layer as the loops.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  guardedExecute,
  getGuardrailConfig,
  type PauseResumeAction,
  type Platform,
  type UpdateCampaignAction,
} from "@engine/core";
import type { Campaign, Decision, Repos } from "@engine/db";

function isoDaysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

async function productMetrics(
  repos: Repos,
  productId: string,
): Promise<{ spend7d: number; runningCost7d: number; conversions7d: number; revenue7d: number }> {
  const since = isoDaysAgo(7);
  const { adSpend, operatingCost } = await repos.costs.sumsByProduct(productId, since);
  const conversions = (await repos.conversions.listCanonicalSince(since)).filter(
    (e) => e.contentId === productId,
  );
  const product = await repos.products.get(productId);
  const marginFactor =
    product?.marginPct !== null && product?.marginPct !== undefined
      ? Number(product.marginPct) / 100
      : 1;
  const revenue =
    conversions.reduce((s, e) => s + (e.value !== null ? Number(e.value) : 0), 0) * marginFactor;
  return {
    spend7d: adSpend,
    runningCost7d: operatingCost,
    conversions7d: conversions.length,
    revenue7d: revenue,
  };
}

function decisionView(d: Decision, outcomes?: { actualOutcome: string }[]) {
  return {
    id: d.id,
    at: d.createdAt,
    actionType: d.actionType,
    loop: d.loop,
    text: d.rationale,
    evidence: d.evidence,
    predictedOutcome: d.predictedOutcome,
    actualOutcome: outcomes?.[0]?.actualOutcome ?? null,
    executed: d.executed,
    guardrailStatus: d.guardrailStatus,
    productId: d.productId,
  };
}

export async function uiRoutes(app: FastifyInstance): Promise<void> {
  // ---- Overview ------------------------------------------------------------
  app.get("/internal/overview", async () => {
    const repos = app.repos;
    const products = await repos.products.list();
    const attention = await repos.attention.listOpen();
    const since = isoDaysAgo(7);
    const { adSpend, operatingCost } = await repos.costs.globalSums(since);
    const conversions = await repos.conversions.listCanonicalSince(since);
    const revenue = conversions.reduce((s, e) => s + (e.value !== null ? Number(e.value) : 0), 0);
    const totalCost = adSpend + operatingCost;

    const learning = products.filter((p) => p.status === "learning" || p.status === "launching").length;
    const needsAttention = attention.length;
    const headline =
      needsAttention > 0 ? "needs_attention" : learning > 0 ? "learning" : "running";

    const productCards = [];
    for (const p of products) {
      const m = await productMetrics(repos, p.id);
      productCards.push({
        id: p.id,
        title: p.title,
        status: p.status,
        spend7d: m.spend7d,
        conversions7d: m.conversions7d,
        revenue7d: m.revenue7d,
        currency: p.currency ?? "AED",
        terminalEvent: (await repos.specs.byProduct(p.id))?.terminalEvent ?? "Purchase",
      });
    }

    // Daily series for sparklines from insights.
    const insightRows = await repos.insights.since(
      isoDaysAgo(7).toISOString().slice(0, 10),
    );
    const spendByDay = new Map<string, number>();
    const convByDay = new Map<string, number>();
    for (const r of insightRows) {
      spendByDay.set(r.date, (spendByDay.get(r.date) ?? 0) + Number(r.spend));
      convByDay.set(r.date, (convByDay.get(r.date) ?? 0) + r.conversions);
    }
    const days = [...spendByDay.keys()].sort();

    return {
      headline,
      counts: { products: products.length, learning, needsAttention },
      kpis: {
        spend7d: adSpend,
        conversions7d: conversions.length,
        runningCost7d: operatingCost,
        netReturn: totalCost > 0 ? revenue / totalCost : null,
        incremental: (await repos.experiments.latestCompleted())?.readout?.incremental_return ?? null,
        spendSeries: days.map((d) => spendByDay.get(d) ?? 0),
        conversionSeries: days.map((d) => convByDay.get(d) ?? 0),
      },
      attention,
      products: productCards,
    };
  });

  // ---- Products ------------------------------------------------------------
  app.get("/internal/products", async () => {
    const products = await app.repos.products.list();
    const out = [];
    for (const p of products) {
      const m = await productMetrics(app.repos, p.id);
      out.push({ ...p, ...m });
    }
    return { products: out };
  });

  app.get<{ Params: { id: string } }>("/internal/products/:id", async (req, reply) => {
    const repos = app.repos;
    const product = await repos.products.get(req.params.id);
    if (!product) return reply.status(404).send({ error: "not_found" });
    const spec = await repos.specs.byProduct(product.id);
    const campaigns = spec ? await repos.campaigns.bySpec(spec.id) : [];
    const m = await productMetrics(repos, product.id);

    // Funnel: canonical conversions per stage, last 7 days.
    const since = isoDaysAgo(7);
    const events = (await repos.conversions.listCanonicalSince(since)).filter(
      (e) => e.contentId === product.id,
    );
    const stages = spec?.funnelStages ?? ["ViewContent", "Purchase"];
    const funnel = stages.map((stage) => ({
      stage,
      count: events.filter((e) => e.eventName === stage).length,
    }));
    // Lead-gen products show closed deals (W3.1) as the true bottom of funnel.
    if (spec?.terminalEvent === "Lead") {
      const closed = events.filter((e) => e.eventName === "Purchase").length;
      if (closed > 0) funnel.push({ stage: "ClosedLead", count: closed });
    }

    const decisions = await repos.decisions.list({ productId: product.id, limit: 30 });
    const activity = [];
    for (const d of decisions) {
      activity.push(decisionView(d, await repos.decisions.outcomesFor(d.id)));
    }

    return {
      product,
      spec: spec ?? null,
      campaigns,
      metrics: { ...m, netReturn: m.spend7d + m.runningCost7d > 0 ? m.revenue7d / (m.spend7d + m.runningCost7d) : null },
      funnel,
      activity,
      creatives: await repos.creatives.byProduct(product.id),
    };
  });

  // ---- Pause / resume / adjust (through guardrails) -------------------------
  async function pauseOrResume(
    productId: string,
    kind: "pause" | "resume",
  ): Promise<{ changed: string[] }> {
    const repos = app.repos;
    const spec = await repos.specs.byProduct(productId);
    if (!spec) return { changed: [] };
    const campaigns = await repos.campaigns.bySpec(spec.id);
    const changed: string[] = [];
    for (const campaign of campaigns) {
      if (!campaign.platformCampaignId) continue;
      if (kind === "pause" && (campaign.status === "paused" || campaign.status === "ended")) continue;
      if (kind === "resume" && campaign.status !== "paused") continue;
      const adapter = app.platforms[campaign.platform as Platform];
      const action: PauseResumeAction = {
        type: kind === "pause" ? "pause_campaign" : "resume_campaign",
        platform: campaign.platform as Platform,
        campaignId: campaign.id,
        platformCampaignId: campaign.platformCampaignId,
      };
      const outcome = await guardedExecute(
        repos,
        {
          loop: "system",
          worker: "operator",
          actionType: kind === "pause" ? "operator_pause" : "operator_resume",
          targetRef: `campaign:${campaign.id}`,
          rationale: kind === "pause" ? "Paused by you. Spending stops; resume any time." : "Resumed by you.",
          productId,
          action,
        },
        (approved) =>
          kind === "pause" ? adapter.pauseCampaign(approved) : adapter.resumeCampaign(approved),
      );
      if (outcome.executed) {
        await repos.campaigns.update(campaign.id, {
          status: kind === "pause" ? "paused" : "learning",
        });
        changed.push(campaign.id);
      }
    }
    await repos.products.update(productId, { status: kind === "pause" ? "paused" : "learning" });
    return { changed };
  }

  app.post<{ Params: { id: string } }>("/internal/products/:id/pause", async (req) =>
    pauseOrResume(req.params.id, "pause"),
  );
  app.post<{ Params: { id: string } }>("/internal/products/:id/resume", async (req) =>
    pauseOrResume(req.params.id, "resume"),
  );

  const intentBody = z.object({
    goal: z.string().optional(),
    daily_budget: z.number().positive().optional(),
    margin_pct: z.number().min(0).max(100).optional(),
  });
  app.patch<{ Params: { id: string } }>("/internal/products/:id/intent", async (req, reply) => {
    const parsed = intentBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: "invalid_body" });
    const repos = app.repos;
    const spec = await repos.specs.byProduct(req.params.id);
    if (!spec) return reply.status(404).send({ error: "no_plan" });
    if (parsed.data.goal) await repos.specs.update(spec.id, { goal: parsed.data.goal });
    if (parsed.data.margin_pct !== undefined) {
      await repos.products.update(req.params.id, {
        marginPct: parsed.data.margin_pct.toFixed(2),
      });
    }

    const blocked: string[] = [];
    if (parsed.data.daily_budget !== undefined) {
      await repos.specs.update(spec.id, { dailyBudget: parsed.data.daily_budget.toFixed(4) });
      for (const campaign of await repos.campaigns.bySpec(spec.id)) {
        if (!campaign.platformCampaignId) continue;
        const adapter = app.platforms[campaign.platform as Platform];
        const current = Number(campaign.budget);
        const action: UpdateCampaignAction = {
          type: "update_campaign",
          platform: campaign.platform as Platform,
          campaignId: campaign.id,
          platformCampaignId: campaign.platformCampaignId,
          changes: { dailyBudget: parsed.data.daily_budget },
        };
        const outcome = await guardedExecute(
          repos,
          {
            loop: "system",
            worker: "operator",
            actionType: "operator_budget_change",
            targetRef: `campaign:${campaign.id}`,
            rationale: `You changed the daily amount to ${parsed.data.daily_budget}.`,
            productId: req.params.id,
            action,
            context: { currentBudget: current },
          },
          (approved) => adapter.updateCampaign(approved),
        );
        if (outcome.executed) {
          await repos.campaigns.update(campaign.id, {
            budget: parsed.data.daily_budget.toFixed(4),
          });
        } else if (outcome.blockedReasons) {
          blocked.push(...outcome.blockedReasons);
        }
      }
    }
    return { ok: true, blocked };
  });

  // ---- Activity --------------------------------------------------------------
  app.get<{ Querystring: { productId?: string; type?: string; limit?: string } }>(
    "/internal/activity",
    async (req) => {
      const decisions = await app.repos.decisions.list({
        productId: req.query.productId,
        limit: Number(req.query.limit ?? 100),
      });
      const typeMap: Record<string, string> = {
        budget_change: "budget",
        operator_budget_change: "budget",
        calendar_pacing: "budget",
        rotate_creatives: "creative",
        request_regeneration: "creative",
        flag_price_creatives: "creative",
        expire_promo_creatives: "creative",
        launch_campaign: "status",
        pause_zero_conversion: "status",
        pause_spend_anomaly: "status",
        pause_stock_out: "status",
        resume_back_in_stock: "status",
        operator_pause: "status",
        operator_resume: "status",
        begin_learning: "status",
        finish_learning: "status",
        promote_allocation_authority: "status",
        deepen_optimization_event: "check",
        token_refreshed: "check",
      };
      const items = [];
      for (const d of decisions) {
        const kind = typeMap[d.actionType] ?? "check";
        if (req.query.type && kind !== req.query.type) continue;
        const product = d.productId ? await app.repos.products.get(d.productId) : undefined;
        items.push({ ...decisionView(d, await app.repos.decisions.outcomesFor(d.id)), kind, productTitle: product?.title ?? null });
      }
      return { items };
    },
  );

  // ---- Settings ----------------------------------------------------------------
  app.get("/internal/settings", async () => {
    const repos = app.repos;
    const accounts = await repos.adAccounts.list();
    const connections = (["meta", "google", "tiktok", "snapchat", "pinterest"] as const).map((platform) => {
      const acct = accounts.find((a) => a.platform === platform);
      return {
        platform,
        connected: acct !== undefined,
        tokenValid: acct?.tokenValid ?? false,
        billingOk: acct?.billingOk ?? false,
        lastCheckedAt: acct?.lastCheckedAt ?? null,
      };
    });
    const playbooks = await repos.playbooks.list();
    const campaigns: Campaign[] = await repos.campaigns.list();
    const products = await repos.products.list();
    const autonomy = [];
    for (const p of products) {
      const spec = await repos.specs.byProduct(p.id);
      const slice = spec ? campaigns.filter((c) => c.specId === spec.id) : [];
      autonomy.push({
        productId: p.id,
        title: p.title,
        autonomous: slice.length > 0 && slice.every((c) => c.allocationAutonomous),
        promotedAt: slice.find((c) => c.promotedAt)?.promotedAt ?? null,
      });
    }
    return {
      connections,
      coverage: await repos.coverage.latest(),
      signal: await repos.signalQuality.latest(),
      guardrails: await getGuardrailConfig(repos),
      killSwitch: await repos.killSwitch.isEngaged(),
      brandKit:
        (await repos.settings.get<Record<string, string>>("brand_kit")) ?? {
          logoUrl: "",
          primaryColor: "#2F4BDA",
          font: "",
          tone: "",
        },
      autonomy,
      pendingSignoffs: playbooks.filter((p) => p.requiresSignoff && !p.signedOffAt),
    };
  });

  app.put("/internal/settings/brand-kit", async (req) => {
    await app.repos.settings.set("brand_kit", (req.body ?? {}) as Record<string, unknown>);
    return { ok: true };
  });
}
