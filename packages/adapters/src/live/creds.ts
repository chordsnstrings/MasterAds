// Per-brand credential resolution (W11). Order: the brand's own connection →
// the account-wide connection → environment variables. Resolved at call time
// so newly saved keys work without code changes.
import type { Repos } from "@engine/db";

type LivePlatform = "meta" | "google" | "tiktok";

const ENV_KEYS: Record<LivePlatform, Record<string, string>> = {
  meta: {
    access_token: "META_ACCESS_TOKEN",
    ad_account_id: "META_AD_ACCOUNT_ID",
    dataset_id: "META_DATASET_ID",
  },
  google: {
    developer_token: "GOOGLE_ADS_DEVELOPER_TOKEN",
    customer_id: "GOOGLE_ADS_CUSTOMER_ID",
    oauth_client_id: "GOOGLE_OAUTH_CLIENT_ID",
    oauth_client_secret: "GOOGLE_OAUTH_CLIENT_SECRET",
    refresh_token: "GOOGLE_ADS_REFRESH_TOKEN",
  },
  tiktok: {
    access_token: "TIKTOK_ACCESS_TOKEN",
    advertiser_id: "TIKTOK_ADVERTISER_ID",
    pixel_code: "TIKTOK_PIXEL_CODE",
  },
};

export interface CredScope {
  productId?: string | null;
  campaignId?: string | null;
  platformCampaignId?: string | null;
}

async function brandIdFor(repos: Repos, scope: CredScope): Promise<string | null> {
  let productId = scope.productId ?? null;
  if (!productId && scope.campaignId) {
    const campaign = await repos.campaigns.get(scope.campaignId);
    const spec = campaign ? await repos.specs.get(campaign.specId) : undefined;
    productId = spec?.productId ?? null;
  }
  if (!productId && scope.platformCampaignId) {
    const campaign = await repos.campaigns.byPlatformCampaignId(scope.platformCampaignId);
    const spec = campaign ? await repos.specs.get(campaign.specId) : undefined;
    productId = spec?.productId ?? null;
  }
  if (!productId) return null;
  const product = await repos.products.get(productId);
  return product?.brandId ?? null;
}

/** Resolve the credentials this action should run under. Throws when a
 *  required key is missing — live mode never guesses. */
export async function resolveCreds(
  repos: Repos,
  platform: LivePlatform,
  scope: CredScope = {},
): Promise<Record<string, string>> {
  const brandId = await brandIdFor(repos, scope);
  const row = await repos.platformConnections.get(platform, brandId);
  const out: Record<string, string> = {};
  for (const [key, envVar] of Object.entries(ENV_KEYS[platform])) {
    const value = row?.credentials[key] ?? process.env[envVar];
    if (value) out[key] = value;
  }
  const missing = Object.keys(ENV_KEYS[platform]).filter(
    (k) => !out[k] && k !== "dataset_id" && k !== "pixel_code",
  );
  if (missing.length > 0) {
    throw new Error(
      `${platform} live call needs ${missing.join(", ")} — connect the account (Settings → Connected accounts${brandId ? ", for this brand" : ""}).`,
    );
  }
  return out;
}
