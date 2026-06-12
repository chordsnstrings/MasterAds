// Google Ads REST live driver (W11). Performance Max campaigns are created
// PAUSED (budget + campaign in one atomic mutate); asset groups are finished
// once in the Google Ads UI before enabling — money only moves after that
// human step. Budget/status changes and insights flow from here.
const ADS_BASE = "https://googleads.googleapis.com/v18";

let cachedToken: { token: string; expiresAt: number; key: string } | null = null;

async function accessToken(creds: Record<string, string>): Promise<string> {
  const key = creds.refresh_token!;
  if (cachedToken && cachedToken.key === key && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.oauth_client_id!,
      client_secret: creds.oauth_client_secret!,
      refresh_token: creds.refresh_token!,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`google oauth ${res.status}: ${json.error ?? "no access token"}`);
  }
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    key,
  };
  return json.access_token;
}

function cid(creds: Record<string, string>): string {
  return creds.customer_id!.replace(/-/g, "");
}

async function adsFetch(
  creds: Record<string, string>,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const token = await accessToken(creds);
  const res = await fetch(`${ADS_BASE}/customers/${cid(creds)}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "developer-token": creds.developer_token!,
      "login-customer-id": cid(creds),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`google ads API ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  }
  return json;
}

export function buildGoogleLiveMutate(
  customerId: string,
  payload: { name: string; dailyBudget: number },
): Record<string, unknown> {
  const budgetResource = `customers/${customerId}/campaignBudgets/-1`;
  return {
    mutateOperations: [
      {
        campaignBudgetOperation: {
          create: {
            resourceName: budgetResource,
            name: `${payload.name} — budget`,
            amountMicros: String(Math.round(payload.dailyBudget * 1_000_000)),
            deliveryMethod: "STANDARD",
          },
        },
      },
      {
        campaignOperation: {
          create: {
            name: payload.name,
            status: "PAUSED",
            advertisingChannelType: "PERFORMANCE_MAX",
            campaignBudget: budgetResource,
            maximizeConversions: {},
            url_expansion_opt_out: false,
          },
        },
      },
    ],
  };
}

export async function googleCreateCampaign(
  creds: Record<string, string>,
  payload: { name: string; dailyBudget: number },
): Promise<string> {
  const res = await adsFetch(creds, "/googleAds:mutate", buildGoogleLiveMutate(cid(creds), payload));
  const results = (res.mutateOperationResponses as Record<string, unknown>[]) ?? [];
  const campaign = results
    .map((r) => (r.campaignResult as { resourceName?: string } | undefined)?.resourceName)
    .find(Boolean);
  if (!campaign) throw new Error("google ads create returned no campaign resource");
  return campaign.split("/").pop()!; // customers/{cid}/campaigns/{id}
}

async function budgetResourceFor(
  creds: Record<string, string>,
  campaignId: string,
): Promise<string> {
  const res = await adsFetch(creds, "/googleAds:searchStream", {
    query: `SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = ${Number(campaignId)}`,
  });
  const chunks = Array.isArray(res) ? (res as Record<string, unknown>[]) : [res];
  for (const chunk of chunks) {
    const rows = (chunk.results as Record<string, unknown>[]) ?? [];
    const budget = (rows[0]?.campaign as { campaignBudget?: string } | undefined)?.campaignBudget;
    if (budget) return budget;
  }
  throw new Error(`google ads: no budget found for campaign ${campaignId}`);
}

export async function googleSetBudget(
  creds: Record<string, string>,
  campaignId: string,
  dailyBudget: number,
): Promise<void> {
  const resourceName = await budgetResourceFor(creds, campaignId);
  await adsFetch(creds, "/campaignBudgets:mutate", {
    operations: [
      {
        update: { resourceName, amountMicros: String(Math.round(dailyBudget * 1_000_000)) },
        updateMask: "amount_micros",
      },
    ],
  });
}

export async function googleSetStatus(
  creds: Record<string, string>,
  campaignId: string,
  active: boolean,
): Promise<void> {
  await adsFetch(creds, "/campaigns:mutate", {
    operations: [
      {
        update: {
          resourceName: `customers/${cid(creds)}/campaigns/${campaignId}`,
          status: active ? "ENABLED" : "PAUSED",
        },
        updateMask: "status",
      },
    ],
  });
}

export async function googleInsights(
  creds: Record<string, string>,
  campaignId: string,
  date: string,
): Promise<{ spend: number; impressions: number; clicks: number; conversions: number; revenue: number }> {
  const res = await adsFetch(creds, "/googleAds:searchStream", {
    query: `SELECT metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE campaign.id = ${Number(campaignId)} AND segments.date = '${date}'`,
  });
  const chunks = Array.isArray(res) ? (res as Record<string, unknown>[]) : [res];
  const out = { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
  for (const chunk of chunks) {
    for (const row of (chunk.results as { metrics?: Record<string, string> }[]) ?? []) {
      const m = row.metrics ?? {};
      out.spend += Number(m.costMicros ?? 0) / 1_000_000;
      out.impressions += Number(m.impressions ?? 0);
      out.clicks += Number(m.clicks ?? 0);
      out.conversions += Number(m.conversions ?? 0);
      out.revenue += Number(m.conversionsValue ?? 0);
    }
  }
  return out;
}

// --- W12: PMax asset-group delivery + per-ad-group insights ------------------

export function buildGoogleAssetGroupMutate(
  customerId: string,
  campaignId: string,
  payload: {
    name: string;
    destinationUrl: string;
    headlines: string[];
    descriptions: string[];
    businessName: string;
    images: { tempId: number; base64: string }[];
  },
): Record<string, unknown> {
  const ops: Record<string, unknown>[] = [];
  const assetRes = (n: number): string => `customers/${customerId}/assets/-${n}`;
  let n = 1;
  const textAssets: { res: string; fieldType: string }[] = [];
  for (const h of payload.headlines.slice(0, 5)) {
    const res = assetRes(n);
    ops.push({ assetOperation: { create: { resourceName: res, textAsset: { text: h.slice(0, 30) } } } });
    textAssets.push({ res, fieldType: "HEADLINE" });
    n++;
  }
  // PMax requires a long headline and descriptions.
  const longRes = assetRes(n);
  ops.push({
    assetOperation: {
      create: { resourceName: longRes, textAsset: { text: (payload.headlines[0] ?? payload.businessName).slice(0, 90) } },
    },
  });
  textAssets.push({ res: longRes, fieldType: "LONG_HEADLINE" });
  n++;
  for (const d of payload.descriptions.slice(0, 4)) {
    const res = assetRes(n);
    ops.push({ assetOperation: { create: { resourceName: res, textAsset: { text: d.slice(0, 90) } } } });
    textAssets.push({ res, fieldType: "DESCRIPTION" });
    n++;
  }
  const bizRes = assetRes(n);
  ops.push({
    assetOperation: {
      create: { resourceName: bizRes, textAsset: { text: payload.businessName.slice(0, 25) } },
    },
  });
  textAssets.push({ res: bizRes, fieldType: "BUSINESS_NAME" });
  n++;
  const imageAssets: { res: string; fieldType: string }[] = [];
  for (const img of payload.images) {
    const res = assetRes(n);
    ops.push({
      assetOperation: { create: { resourceName: res, imageAsset: { data: img.base64 } } },
    });
    imageAssets.push({ res, fieldType: "MARKETING_IMAGE" });
    n++;
  }
  const groupRes = `customers/${customerId}/assetGroups/-${n}`;
  ops.push({
    assetGroupOperation: {
      create: {
        resourceName: groupRes,
        campaign: `customers/${customerId}/campaigns/${campaignId}`,
        name: `${payload.name} — assets`,
        finalUrls: [payload.destinationUrl],
        status: "PAUSED",
      },
    },
  });
  for (const t of [...textAssets, ...imageAssets]) {
    ops.push({
      assetGroupAssetOperation: {
        create: { assetGroup: groupRes, asset: t.res, fieldType: t.fieldType },
      },
    });
  }
  return { mutateOperations: ops };
}

export async function googleDeliverAssets(
  creds: Record<string, string>,
  campaignId: string,
  payload: {
    name: string;
    destinationUrl: string;
    headlines: string[];
    descriptions: string[];
    businessName: string;
    images: { tempId: number; base64: string }[];
  },
): Promise<string> {
  const res = await adsFetch(
    creds,
    "/googleAds:mutate",
    buildGoogleAssetGroupMutate(cid(creds), campaignId, payload),
  );
  const results = (res.mutateOperationResponses as Record<string, unknown>[]) ?? [];
  const group = results
    .map((r) => (r.assetGroupResult as { resourceName?: string } | undefined)?.resourceName)
    .find(Boolean);
  return group ?? "";
}

/** PMax has no per-ad level — asset-group performance is the closest analog. */
export async function googleAdInsights(
  creds: Record<string, string>,
  campaignId: string,
  date: string,
): Promise<{ platformAdId: string; spend: number; impressions: number; clicks: number; conversions: number; revenue: number }[]> {
  const res = await adsFetch(creds, "/googleAds:searchStream", {
    query: `SELECT asset_group.resource_name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM asset_group WHERE campaign.id = ${Number(campaignId)} AND segments.date = '${date}'`,
  });
  const chunks = Array.isArray(res) ? (res as Record<string, unknown>[]) : [res];
  const out: { platformAdId: string; spend: number; impressions: number; clicks: number; conversions: number; revenue: number }[] = [];
  for (const chunk of chunks) {
    for (const row of (chunk.results as { assetGroup?: { resourceName?: string }; metrics?: Record<string, string> }[]) ?? []) {
      const m = row.metrics ?? {};
      out.push({
        platformAdId: row.assetGroup?.resourceName ?? "asset_group",
        spend: Number(m.costMicros ?? 0) / 1_000_000,
        impressions: Number(m.impressions ?? 0),
        clicks: Number(m.clicks ?? 0),
        conversions: Number(m.conversions ?? 0),
        revenue: Number(m.conversionsValue ?? 0),
      });
    }
  }
  return out;
}
