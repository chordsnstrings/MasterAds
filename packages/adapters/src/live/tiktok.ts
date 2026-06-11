// TikTok Business API live driver (W11). Campaigns are created DISABLED on
// the platform; a human enables them once in TikTok Ads Manager before any
// money moves. Budget/status changes flow from here afterwards.
const BASE = "https://business-api.tiktok.com/open_api/v1.3";

async function ttFetch(
  path: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "Access-Token": token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as { code: number; message: string; data?: Record<string, unknown> };
  if (!res.ok || json.code !== 0) {
    throw new Error(`tiktok API ${res.status}/${json.code}: ${json.message}`);
  }
  return json.data ?? {};
}

export function buildTikTokLiveCreateBody(
  advertiserId: string,
  payload: { name: string; objective: string; dailyBudget: number },
): Record<string, unknown> {
  return {
    advertiser_id: advertiserId,
    campaign_name: payload.name,
    objective_type: payload.objective,
    budget_mode: "BUDGET_MODE_DAY",
    budget: payload.dailyBudget,
    operation_status: "DISABLE",
  };
}

export async function tiktokCreateCampaign(
  creds: Record<string, string>,
  payload: { name: string; objective: string; dailyBudget: number },
): Promise<string> {
  const data = await ttFetch(
    "/campaign/create/",
    creds.access_token!,
    buildTikTokLiveCreateBody(creds.advertiser_id!, payload),
  );
  return String((data as { campaign_id?: unknown }).campaign_id);
}

export async function tiktokSetBudget(
  creds: Record<string, string>,
  platformCampaignId: string,
  dailyBudget: number,
): Promise<void> {
  await ttFetch("/campaign/update/", creds.access_token!, {
    advertiser_id: creds.advertiser_id,
    campaign_id: platformCampaignId,
    budget: dailyBudget,
  });
}

export async function tiktokSetStatus(
  creds: Record<string, string>,
  platformCampaignId: string,
  active: boolean,
): Promise<void> {
  await ttFetch("/campaign/status/update/", creds.access_token!, {
    advertiser_id: creds.advertiser_id,
    campaign_ids: [platformCampaignId],
    operation_status: active ? "ENABLE" : "DISABLE",
  });
}

export async function tiktokInsights(
  creds: Record<string, string>,
  platformCampaignId: string,
  date: string,
): Promise<{ spend: number; impressions: number; clicks: number; conversions: number; revenue: number }> {
  const params = new URLSearchParams({
    advertiser_id: creds.advertiser_id!,
    report_type: "BASIC",
    data_level: "AUCTION_CAMPAIGN",
    dimensions: JSON.stringify(["campaign_id"]),
    metrics: JSON.stringify(["spend", "impressions", "clicks", "conversion", "total_complete_payment"]),
    start_date: date,
    end_date: date,
    filters: JSON.stringify([
      { field_name: "campaign_ids", filter_type: "IN", filter_value: JSON.stringify([platformCampaignId]) },
    ]),
  });
  const data = await ttFetch(`/report/integrated/get/?${params.toString()}`, creds.access_token!);
  const row =
    ((data as { list?: { metrics: Record<string, string> }[] }).list ?? [])[0]?.metrics ?? {};
  return {
    spend: Number(row.spend ?? 0),
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    conversions: Number(row.conversion ?? 0),
    revenue: Number(row.total_complete_payment ?? 0),
  };
}
