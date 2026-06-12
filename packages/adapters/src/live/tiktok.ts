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

// --- W12: creative delivery — assets become real (disabled) ads --------------

export async function tiktokDeliverCreatives(
  creds: Record<string, string>,
  payload: {
    name: string;
    platformCampaignId: string;
    optimizationEvent: string;
    destinationUrl: string;
    brandName: string;
  },
  assets: { creativeId: string; assetType: string; assetRef: string; headline: string; body: string }[],
  publicBaseUrl: string,
): Promise<Record<string, string>> {
  const token = creds.access_token!;
  const advertiserId = creds.advertiser_id!;

  // One identity per advertiser (required for ads); idempotent by name.
  const identities = await ttFetch(
    `/identity/get/?advertiser_id=${advertiserId}&page_size=50`,
    token,
  );
  let identityId = (
    (identities as { identity_list?: { identity_id: string; display_name: string }[] }).identity_list ?? []
  ).find((i) => i.display_name === payload.brandName)?.identity_id;
  if (!identityId) {
    const created = await ttFetch("/identity/create/", token, {
      advertiser_id: advertiserId,
      display_name: payload.brandName,
    });
    identityId = String((created as { identity_id?: unknown }).identity_id);
  }

  // One delivery ad group under the campaign (DISABLED until a human enables).
  const adgroup = await ttFetch("/adgroup/create/", token, {
    advertiser_id: advertiserId,
    campaign_id: payload.platformCampaignId,
    adgroup_name: `${payload.name} — delivery`,
    promotion_type: "WEBSITE",
    placement_type: "PLACEMENT_TYPE_AUTOMATIC",
    optimization_goal: "CONVERT",
    optimization_event: payload.optimizationEvent,
    pixel_id: creds.pixel_code,
    billing_event: "OCPM",
    bid_type: "BID_TYPE_NO_BID",
    budget_mode: "BUDGET_MODE_INFINITE",
    schedule_type: "SCHEDULE_FROM_NOW",
    schedule_start_time: new Date().toISOString().slice(0, 19).replace("T", " "),
    operation_status: "DISABLE",
  });
  const adgroupId = String((adgroup as { adgroup_id?: unknown }).adgroup_id);

  const delivered: Record<string, string> = {};
  for (const asset of assets) {
    const url = asset.assetRef.startsWith("http")
      ? asset.assetRef
      : `${publicBaseUrl}${asset.assetRef}`;
    let creative: Record<string, unknown>;
    if (asset.assetType === "video") {
      const up = await ttFetch("/file/video/ad/upload/", token, {
        advertiser_id: advertiserId,
        upload_type: "UPLOAD_BY_URL",
        video_url: url,
        file_name: `${asset.creativeId}.mp4`,
      });
      const videoId = String((up as { video_id?: unknown }).video_id ?? "");
      creative = { ad_format: "SINGLE_VIDEO", video_id: videoId };
    } else {
      const up = await ttFetch("/file/image/ad/upload/", token, {
        advertiser_id: advertiserId,
        upload_type: "UPLOAD_BY_URL",
        image_url: url,
        file_name: `${asset.creativeId}.png`,
      });
      creative = { ad_format: "SINGLE_IMAGE", image_ids: [String((up as { image_id?: unknown }).image_id)] };
    }
    const ad = await ttFetch("/ad/create/", token, {
      advertiser_id: advertiserId,
      adgroup_id: adgroupId,
      creatives: [
        {
          ad_name: `${payload.name} — ${asset.creativeId.slice(-6)}`,
          identity_type: "CUSTOMIZED_USER",
          identity_id: identityId,
          ad_text: asset.body || asset.headline,
          call_to_action: "LEARN_MORE",
          landing_page_url: payload.destinationUrl,
          ...creative,
        },
      ],
    });
    const adIds = (ad as { ad_ids?: unknown[] }).ad_ids ?? [];
    if (adIds[0]) delivered[asset.creativeId] = String(adIds[0]);
  }
  return delivered;
}

export async function tiktokAdInsights(
  creds: Record<string, string>,
  platformAdIds: string[],
  date: string,
): Promise<{ platformAdId: string; spend: number; impressions: number; clicks: number; conversions: number; revenue: number }[]> {
  const params = new URLSearchParams({
    advertiser_id: creds.advertiser_id!,
    report_type: "BASIC",
    data_level: "AUCTION_AD",
    dimensions: JSON.stringify(["ad_id"]),
    metrics: JSON.stringify(["spend", "impressions", "clicks", "conversion", "total_complete_payment"]),
    start_date: date,
    end_date: date,
    filters: JSON.stringify([
      { field_name: "ad_ids", filter_type: "IN", filter_value: JSON.stringify(platformAdIds) },
    ]),
    page_size: "200",
  });
  const data = await ttFetch(`/report/integrated/get/?${params.toString()}`, creds.access_token!);
  return (
    (data as { list?: { dimensions: { ad_id: string }; metrics: Record<string, string> }[] }).list ?? []
  ).map((row) => ({
    platformAdId: row.dimensions.ad_id,
    spend: Number(row.metrics.spend ?? 0),
    impressions: Number(row.metrics.impressions ?? 0),
    clicks: Number(row.metrics.clicks ?? 0),
    conversions: Number(row.metrics.conversion ?? 0),
    revenue: Number(row.metrics.total_complete_payment ?? 0),
  }));
}
