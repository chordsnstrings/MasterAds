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
