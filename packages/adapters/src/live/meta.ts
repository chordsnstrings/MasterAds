// Meta Marketing API live driver (W11). First live launches create the
// campaign PAUSED on the platform — money only moves after a human enables it
// in Ads Manager once; from then on budget/status changes flow from here.
const V = "v21.0";
const BASE = `https://graph.facebook.com/${V}`;

async function metaFetch(
  path: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = `${BASE}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error as { message?: string } | undefined)?.message ?? JSON.stringify(json);
    throw new Error(`meta API ${res.status}: ${err}`);
  }
  return json;
}

export function buildMetaLiveCreateBody(payload: {
  name: string;
  objective: string;
  policyCategory: string;
  dailyBudget: number;
}): Record<string, unknown> {
  return {
    name: payload.name,
    objective: payload.objective,
    status: "PAUSED",
    special_ad_categories:
      payload.policyCategory === "restricted" ? ["FINANCIAL_PRODUCTS_SERVICES"] : [],
    daily_budget: Math.round(payload.dailyBudget * 100),
    // Advantage+ shopping for sales; other objectives run as standard AI campaigns.
    ...(payload.objective === "OUTCOME_SALES"
      ? { smart_promotion_type: "AUTOMATED_SHOPPING_ADS" }
      : {}),
  };
}

export async function metaCreateCampaign(
  creds: Record<string, string>,
  payload: { name: string; objective: string; policyCategory: string; dailyBudget: number },
): Promise<string> {
  const acct = creds.ad_account_id!.startsWith("act_")
    ? creds.ad_account_id!
    : `act_${creds.ad_account_id}`;
  const res = await metaFetch(`${acct}/campaigns`, creds.access_token!, buildMetaLiveCreateBody(payload));
  return String(res.id);
}

export async function metaSetBudget(
  creds: Record<string, string>,
  platformCampaignId: string,
  dailyBudget: number,
): Promise<void> {
  await metaFetch(platformCampaignId, creds.access_token!, {
    daily_budget: Math.round(dailyBudget * 100),
  });
}

export async function metaSetStatus(
  creds: Record<string, string>,
  platformCampaignId: string,
  active: boolean,
): Promise<void> {
  await metaFetch(platformCampaignId, creds.access_token!, {
    status: active ? "ACTIVE" : "PAUSED",
  });
}

export async function metaInsights(
  creds: Record<string, string>,
  platformCampaignId: string,
  date: string,
): Promise<{ spend: number; impressions: number; clicks: number; conversions: number; revenue: number }> {
  const fields = "spend,impressions,clicks,actions,action_values";
  const range = encodeURIComponent(JSON.stringify({ since: date, until: date }));
  const res = await metaFetch(
    `${platformCampaignId}/insights?fields=${fields}&time_range=${range}`,
    creds.access_token!,
  );
  const row = ((res.data as Record<string, unknown>[]) ?? [])[0] ?? {};
  const actions = (row.actions as { action_type: string; value: string }[]) ?? [];
  const actionValues = (row.action_values as { action_type: string; value: string }[]) ?? [];
  const isResult = (t: string): boolean => /purchase|lead|complete_registration/i.test(t);
  return {
    spend: Number(row.spend ?? 0),
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    conversions: actions.filter((a) => isResult(a.action_type)).reduce((s, a) => s + Number(a.value), 0),
    revenue: actionValues
      .filter((a) => /purchase/i.test(a.action_type))
      .reduce((s, a) => s + Number(a.value), 0),
  };
}

// --- W12: creative delivery — assets become real (paused) ads ---------------

export interface DeliverableAsset {
  creativeId: string;
  assetType: string;
  assetRef: string;
  headline: string;
  body: string;
}

export type MediaFetcher = (
  assetRef: string,
) => Promise<{ mime: string; base64: string } | undefined>;

const META_BILLING_OPT: Record<string, { goal: string; billing: string }> = {
  OUTCOME_SALES: { goal: "OFFSITE_CONVERSIONS", billing: "IMPRESSIONS" },
  OUTCOME_LEADS: { goal: "OFFSITE_CONVERSIONS", billing: "IMPRESSIONS" },
  OUTCOME_TRAFFIC: { goal: "LINK_CLICKS", billing: "IMPRESSIONS" },
  OUTCOME_APP_PROMOTION: { goal: "APP_INSTALLS", billing: "IMPRESSIONS" },
};

export function buildMetaAdsetBody(payload: {
  name: string;
  platformCampaignId: string;
  objective: string;
  datasetId?: string;
  optimizationEvent: string;
  countries: string[];
}): Record<string, unknown> {
  const opt = META_BILLING_OPT[payload.objective] ?? META_BILLING_OPT.OUTCOME_SALES!;
  return {
    name: `${payload.name} — delivery`,
    campaign_id: payload.platformCampaignId,
    status: "PAUSED",
    optimization_goal: opt.goal,
    billing_event: opt.billing,
    targeting: {
      geo_locations: { countries: payload.countries },
      targeting_automation: { advantage_audience: 1 },
    },
    ...(payload.datasetId && opt.goal === "OFFSITE_CONVERSIONS"
      ? {
          promoted_object: {
            pixel_id: payload.datasetId,
            custom_event_type: payload.optimizationEvent,
          },
        }
      : {}),
  };
}

export function buildMetaCreativeBody(payload: {
  name: string;
  pageId?: string;
  destinationUrl: string;
  imageHashes: string[];
  videoIds: string[];
  titles: string[];
  bodies: string[];
}): Record<string, unknown> {
  return {
    name: `${payload.name} — creative`,
    object_story_spec: { page_id: payload.pageId ?? "PAGE_ID_REQUIRED" },
    asset_feed_spec: {
      images: payload.imageHashes.map((hash) => ({ hash })),
      videos: payload.videoIds.map((video_id) => ({ video_id })),
      titles: payload.titles.map((text) => ({ text })),
      bodies: payload.bodies.map((text) => ({ text })),
      link_urls: [{ website_url: payload.destinationUrl }],
      ad_formats: ["AUTOMATIC_FORMAT"],
      call_to_action_types: ["LEARN_MORE"],
    },
  };
}

/**
 * Uploads assets, creates one Advantage+-audience ad set and one
 * asset-feed ad per creative — everything PAUSED. Returns creativeId → ad id.
 */
export async function metaDeliverCreatives(
  creds: Record<string, string>,
  payload: {
    name: string;
    platformCampaignId: string;
    objective: string;
    optimizationEvent: string;
    destinationUrl: string;
    countries: string[];
  },
  assets: DeliverableAsset[],
  fetchMedia: MediaFetcher,
  publicBaseUrl: string,
): Promise<Record<string, string>> {
  const acct = creds.ad_account_id!.startsWith("act_")
    ? creds.ad_account_id!
    : `act_${creds.ad_account_id}`;
  const token = creds.access_token!;

  const adset = await metaFetch(
    `${acct}/adsets`,
    token,
    buildMetaAdsetBody({
      name: payload.name,
      platformCampaignId: payload.platformCampaignId,
      objective: payload.objective,
      datasetId: creds.dataset_id,
      optimizationEvent: payload.optimizationEvent,
      countries: payload.countries,
    }),
  );

  const delivered: Record<string, string> = {};
  for (const asset of assets) {
    let imageHashes: string[] = [];
    let videoIds: string[] = [];
    if (asset.assetType === "video") {
      const url = asset.assetRef.startsWith("http")
        ? asset.assetRef
        : `${publicBaseUrl}${asset.assetRef}`;
      const video = await metaFetch(`${acct}/advideos`, token, { file_url: url });
      videoIds = [String(video.id)];
    } else {
      const media = await fetchMedia(asset.assetRef);
      if (!media) continue;
      const img = await metaFetch(`${acct}/adimages`, token, { bytes: media.base64 });
      const images = (img.images as Record<string, { hash: string }>) ?? {};
      const hash = Object.values(images)[0]?.hash;
      if (!hash) continue;
      imageHashes = [hash];
    }
    const creative = await metaFetch(
      `${acct}/adcreatives`,
      token,
      buildMetaCreativeBody({
        name: `${payload.name} — ${asset.creativeId.slice(-6)}`,
        pageId: creds.page_id,
        destinationUrl: payload.destinationUrl,
        imageHashes,
        videoIds,
        titles: [asset.headline].filter(Boolean),
        bodies: [asset.body].filter(Boolean),
      }),
    );
    const ad = await metaFetch(`${acct}/ads`, token, {
      name: `${payload.name} — ad ${asset.creativeId.slice(-6)}`,
      adset_id: adset.id,
      creative: { creative_id: creative.id },
      status: "PAUSED",
    });
    delivered[asset.creativeId] = String(ad.id);
  }
  return delivered;
}

export async function metaAdInsights(
  creds: Record<string, string>,
  platformCampaignId: string,
  platformAdIds: string[],
  date: string,
): Promise<{ platformAdId: string; spend: number; impressions: number; clicks: number; conversions: number; revenue: number }[]> {
  const fields = "ad_id,spend,impressions,clicks,actions,action_values";
  const range = encodeURIComponent(JSON.stringify({ since: date, until: date }));
  const res = await metaFetch(
    `${platformCampaignId}/insights?level=ad&fields=${fields}&time_range=${range}&limit=200`,
    creds.access_token!,
  );
  const wanted = new Set(platformAdIds);
  const isResult = (t: string): boolean => /purchase|lead|complete_registration/i.test(t);
  return (((res.data as Record<string, unknown>[]) ?? []) as {
    ad_id: string;
    spend?: string;
    impressions?: string;
    clicks?: string;
    actions?: { action_type: string; value: string }[];
    action_values?: { action_type: string; value: string }[];
  }[])
    .filter((r) => wanted.has(r.ad_id))
    .map((r) => ({
      platformAdId: r.ad_id,
      spend: Number(r.spend ?? 0),
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      conversions: (r.actions ?? []).filter((a) => isResult(a.action_type)).reduce((s, a) => s + Number(a.value), 0),
      revenue: (r.action_values ?? [])
        .filter((a) => /purchase/i.test(a.action_type))
        .reduce((s, a) => s + Number(a.value), 0),
    }));
}
