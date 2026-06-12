// Insights pull job (G7): spend, impressions, conversions per campaign into
// Postgres on a regular cadence; ad_spend CostEvents written from
// platform-reported spend (SW §6.1). Idempotent per (campaign, date).
import type { Repos } from "@engine/db";

export interface InsightsReader {
  readInsights(
    scope: { platformCampaignId: string },
    window: { date: string },
  ): Promise<{
    date: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    revenue: number;
    currency: string;
  }>;
  readAdInsights(
    scope: { platformCampaignId: string; platformAdIds: string[] },
    window: { date: string },
  ): Promise<
    { platformAdId: string; spend: number; impressions: number; clicks: number; conversions: number; revenue: number }[]
  >;
}

export function yesterdayUtc(now = new Date()): string {
  return new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
}

export async function runInsightsPull(
  repos: Repos,
  adapters: Record<string, InsightsReader>,
  date: string = yesterdayUtc(),
): Promise<{ pulled: number; costEvents: number; adRows: number }> {
  const campaigns = await repos.campaigns.listActive();
  let pulled = 0;
  let costEvents = 0;
  let adRows = 0;
  for (const campaign of campaigns) {
    if (!campaign.platformCampaignId) continue;
    const adapter = adapters[campaign.platform];
    if (!adapter) continue;
    const report = await adapter.readInsights(
      { platformCampaignId: campaign.platformCampaignId },
      { date },
    );
    const { inserted } = await repos.insights.insertIdempotent({
      campaignId: campaign.id,
      date,
      spend: report.spend.toFixed(4),
      impressions: report.impressions,
      clicks: report.clicks,
      conversions: report.conversions,
      revenue: report.revenue.toFixed(4),
      currency: report.currency,
    });
    pulled++;
    if (inserted && report.spend > 0) {
      const spec = await repos.specs.get(campaign.specId);
      await repos.costs.insert({
        costType: "ad_spend",
        providerOrPlatform: campaign.platform,
        units: {},
        amount: report.spend.toFixed(6),
        currency: report.currency,
        productId: spec?.productId ?? null,
        campaignId: campaign.id,
        occurredAt: new Date(`${date}T12:00:00Z`),
      });
      costEvents++;
    }

    // W12: per-ad metrics for every mapped ad (creative → platform ad id),
    // so "which ad wins" is measured, not inferred. No extra CostEvents —
    // campaign-level spend already feeds the ledger.
    const mappings = await repos.creativeAds.byCampaign(campaign.id);
    if (mappings.length > 0) {
      const rows = await adapter.readAdInsights(
        {
          platformCampaignId: campaign.platformCampaignId,
          platformAdIds: mappings.map((m) => m.platformAdId),
        },
        { date },
      );
      const byAdId = new Map(mappings.map((m) => [m.platformAdId, m.creativeId]));
      for (const row of rows) {
        await repos.adInsights.insertIdempotent({
          campaignId: campaign.id,
          creativeId: byAdId.get(row.platformAdId) ?? null,
          platformAdId: row.platformAdId,
          date,
          spend: row.spend.toFixed(4),
          impressions: row.impressions,
          clicks: row.clicks,
          conversions: row.conversions,
          revenue: row.revenue.toFixed(4),
        });
        adRows++;
      }
    }
  }
  return { pulled, costEvents, adRows };
}
