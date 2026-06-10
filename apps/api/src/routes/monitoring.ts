// Operational monitoring (SW §11.3), surfaced internally: coverage,
// learning-phase status, EMQ placeholder, spend + operating-cost anomalies,
// reconciliation drift, net return.
import type { FastifyInstance } from "fastify";
import { getGuardrailConfig } from "@engine/core";

export async function monitoringRoutes(app: FastifyInstance): Promise<void> {
  app.get("/internal/monitoring", async () => {
    const repos = app.repos;
    const since = new Date(Date.now() - 7 * 86_400_000);
    const config = await getGuardrailConfig(repos);

    // Learning-phase status per campaign; alert on campaigns failing to exit.
    const campaigns = await repos.campaigns.list();
    const learning = campaigns
      .filter((c) => c.status !== "ended")
      .map((c) => {
        const ageDays = (Date.now() - c.createdAt.getTime()) / 86_400_000;
        return {
          campaignId: c.id,
          platform: c.platform,
          learningState: c.learningState,
          allocationAutonomous: c.allocationAutonomous,
          ageDays: Math.round(ageDays * 10) / 10,
          stuck: c.learningState !== "exited" && ageDays > 14,
        };
      });

    // Reconciliation drift: platform claims vs canonical (SW §8.5).
    const window = await repos.conversions.listWindow(since, new Date());
    const canonical = window.filter((e) => e.canonical).length;
    const claims = window.length;

    // Cost anomalies: operating cost today vs caps; open spend anomalies.
    const dayStart = new Date(new Date().toISOString().slice(0, 10));
    const today = await repos.costs.globalSums(dayStart);
    const weekly = await repos.costs.globalSums(since);
    const conversions = await repos.conversions.listCanonicalSince(since);
    const revenue = conversions.reduce((s, e) => s + (e.value !== null ? Number(e.value) : 0), 0);
    const totalCost = weekly.adSpend + weekly.operatingCost;
    const attention = await repos.attention.listOpen();

    return {
      coverage: await repos.coverage.latest(),
      learning,
      // Event Match Quality is platform-reported; populated once live
      // credentials exist (P5). Kept visible so the gap is explicit.
      emq: { meta: null, google: null, tiktok: null, note: "available in live mode (P5)" },
      anomalies: {
        openSpendAnomalies: attention.filter((a) => a.kind === "spend_anomaly").length,
        operatingCostTodayUsd: today.operatingCost,
        operatingCostCapUsd: config.operatingCostDailyCapUsd,
        operatingCostBreached: today.operatingCost > config.operatingCostDailyCapUsd,
      },
      reconciliation: {
        windowDays: 7,
        claims,
        canonical,
        driftPct: claims > 0 ? Math.round(((claims - canonical) / claims) * 10000) / 100 : 0,
      },
      netReturn: {
        revenue7d: revenue,
        adSpend7d: weekly.adSpend,
        operatingCost7d: weekly.operatingCost,
        netReturn: totalCost > 0 ? revenue / totalCost : null,
        operatingCostPctOfAdSpend:
          weekly.adSpend > 0 ? Math.round((weekly.operatingCost / weekly.adSpend) * 10000) / 100 : null,
      },
      killSwitch: await repos.killSwitch.isEngaged(),
      openAttention: attention.length,
    };
  });
}
