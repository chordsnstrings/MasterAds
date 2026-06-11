// Thin typed client over the internal API.
export interface AttentionItem {
  id: string;
  kind: string;
  severity: "warning" | "approval" | "error";
  message: string;
  fixHint: string | null;
  targetRef: string | null;
}

export interface ProductCardData {
  id: string;
  title: string;
  status: string;
  spend7d: number;
  conversions7d: number;
  revenue7d: number;
  currency: string;
  terminalEvent: string;
}

export interface OverviewData {
  headline: "running" | "learning" | "needs_attention";
  checklist: {
    dismissed: boolean;
    items: { accounts: boolean; site: boolean; brandKit: boolean; guardrails: boolean };
  };
  counts: { products: number; learning: number; needsAttention: number };
  kpis: {
    spend7d: number;
    conversions7d: number;
    runningCost7d: number;
    netReturn: number | null;
    incremental: number | null;
    spendSeries: number[];
    conversionSeries: number[];
  };
  attention: AttentionItem[];
  products: ProductCardData[];
}

export interface ActivityEntry {
  id: string;
  at: string;
  actionType: string;
  kind: string;
  text: string;
  evidence: { metric: string; window: string; result: string }[];
  predictedOutcome: string | null;
  actualOutcome: string | null;
  executed: boolean;
  guardrailStatus: string;
  productId: string | null;
  productTitle?: string | null;
}

export interface ProductDetailData {
  product: {
    id: string;
    title: string;
    status: string;
    currency: string | null;
    description: string | null;
  };
  spec: {
    id: string;
    goal: string | null;
    dailyBudget: string | null;
    budgetCurrency: string | null;
    targetPlatforms: string[];
    terminalEvent: string;
  } | null;
  metrics: {
    spend7d: number;
    runningCost7d: number;
    conversions7d: number;
    revenue7d: number;
    netReturn: number | null;
  };
  funnel: { stage: string; count: number }[];
  activity: ActivityEntry[];
  campaigns: { id: string; platform: string; status: string }[];
}

export interface SettingsData {
  connections: {
    platform: string;
    mode: "stub" | "live";
    connected: boolean;
    tokenValid: boolean;
    billingOk: boolean;
    accountRef: string | null;
  }[];
  coverage: { sourceSite: string; platform: string; coveragePct: string }[];
  signal: { sourceSite: string; avgScore: string; eventsTotal: number }[];
  guardrails: Record<string, number | string>;
  killSwitch: boolean;
  brandKit: Record<string, string>;
  autonomy: { productId: string; title: string; autonomous: boolean; promotedAt: string | null }[];
  pendingSignoffs: { id: string; vertical: string }[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export function getOperatorKey(): string | null {
  return localStorage.getItem("operatorKey");
}

export function setOperatorKey(key: string): void {
  localStorage.setItem("operatorKey", key);
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const operatorKey = getOperatorKey();
  if (operatorKey) headers["x-operator-key"] = operatorKey;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new ApiError(`${method} ${url} → ${res.status}`, res.status);
  return (await res.json()) as T;
}

export interface PlanData {
  specId: string;
  goal: string | null;
  platforms: string[];
  perDay: number;
  currency: string | null;
  destination: { kind: string; value: string } | null;
  policyCategory: "standard" | "restricted";
  needsDestinationChoice?: boolean;
  launchAllowed?: boolean;
  needsDisambiguation?: boolean;
  question?: string;
}

export interface CreativePreview {
  id: string;
  variantNo: number;
  format: string;
  assetRef: string;
  headline?: string;
  body?: string;
  status: string;
}

export const api = {
  intake: (input: string) =>
    request<{ intakeId: string; status: string }>("POST", "/v1/intake", { input }),
  intakeFile: (filename: string, contentBase64: string) =>
    request<{ intakeId: string; status: string }>("POST", "/v1/intake/file", {
      filename,
      content_base64: contentBase64,
    }),
  intakeStatus: (id: string) =>
    request<{
      intakeId: string;
      status: "reading" | "done" | "unreadable";
      result: {
        kind?: string;
        suggestion?: string;
        productIds?: string[];
        productCount?: number;
        catalogGroupId?: string;
      } | null;
    }>("GET", `/v1/intake/${id}`),
  plan: (
    productId: string,
    body: { goal?: string; daily_budget?: number; disambiguation?: "product" | "service" },
  ) => request<PlanData>("POST", `/v1/products/${productId}/plan`, body),
  generateCreatives: (specId: string) =>
    request<{ creatives: CreativePreview[] }>("POST", `/v1/specs/${specId}/creatives`),
  patchSpec: (
    specId: string,
    body: {
      goal?: string;
      daily_budget?: number;
      destination?: { kind: string; value: string };
      target_platforms?: string[];
    },
  ) => request<PlanData>("PATCH", `/v1/specs/${specId}`, body),
  editCreative: (id: string, body: { headline?: string; body?: string }) =>
    request("PATCH", `/v1/creatives/${id}`, body),
  launch: (specId: string) =>
    request<{ status: "live" | "in_review"; dailyCap?: number; currency?: string }>(
      "POST",
      `/v1/specs/${specId}/launch`,
    ),
  overview: () => request<OverviewData>("GET", "/internal/overview"),
  dismissChecklist: () => request<{ ok: boolean }>("POST", "/internal/checklist/dismiss"),
  connections: () =>
    request<{
      ai: {
        savedAt: string | null;
        provider: string | null;
        mode: string;
        fields: {
          key: string;
          secret: boolean;
          required: boolean;
          choices: string[] | null;
          savedMask: string | null;
        }[];
      };
      platforms: {
        platform: string;
        adAccountRef: string | null;
        savedAt: string | null;
        fields: {
          key: string;
          secret: boolean;
          required: boolean;
          isAccountRef: boolean;
          savedMask: string | null;
        }[];
      }[];
    }>("GET", "/internal/connections"),
  saveConnection: (platform: string, credentials: Record<string, string>) =>
    request<{ platform: string; adAccountRef: string | null; saved: string[] }>(
      "POST",
      `/internal/connections/${platform}`,
      { credentials },
    ),
  products: () => request<{ products: (ProductCardData & { status: string })[] }>("GET", "/internal/products"),
  product: (id: string) => request<ProductDetailData>("GET", `/internal/products/${id}`),
  activity: (params: { type?: string; productId?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.type) q.set("type", params.type);
    if (params.productId) q.set("productId", params.productId);
    return request<{ items: ActivityEntry[] }>("GET", `/internal/activity?${q.toString()}`);
  },
  settings: () => request<SettingsData>("GET", "/internal/settings"),
  pause: (id: string) => request("POST", `/internal/products/${id}/pause`),
  resume: (id: string) => request("POST", `/internal/products/${id}/resume`),
  adjustIntent: (id: string, body: { goal?: string; daily_budget?: number; margin_pct?: number }) =>
    request<{ ok: boolean; blocked: string[] }>("PATCH", `/internal/products/${id}/intent`, body),
  resolveAttention: (id: string) => request("POST", `/internal/attention/${id}/resolve`),
  setKillSwitch: (engaged: boolean) =>
    request("POST", "/internal/kill-switch", { engaged }),
  patchGuardrails: (patch: Record<string, number>) =>
    request("PATCH", "/internal/guardrails", patch),
  saveBrandKit: (kit: Record<string, string>) => request("PUT", "/internal/settings/brand-kit", kit),
  signOffPlaybook: (id: string) => request("POST", `/internal/playbooks/${id}/signoff`, {}),
  sites: () =>
    request<{ sites: { sourceSite: string; label: string | null }[] }>("GET", "/internal/sites"),
  addSite: (site: string, label?: string) =>
    request<{ site: string; key: string }>("POST", "/internal/sites", { site, label }),
};
