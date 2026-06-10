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
    connected: boolean;
    tokenValid: boolean;
    billingOk: boolean;
  }[];
  coverage: { sourceSite: string; platform: string; coveragePct: string }[];
  guardrails: Record<string, number | string>;
  killSwitch: boolean;
  brandKit: Record<string, string>;
  autonomy: { productId: string; title: string; autonomous: boolean; promotedAt: string | null }[];
  pendingSignoffs: { id: string; vertical: string }[];
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  overview: () => request<OverviewData>("GET", "/internal/overview"),
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
  adjustIntent: (id: string, body: { goal?: string; daily_budget?: number }) =>
    request<{ ok: boolean; blocked: string[] }>("PATCH", `/internal/products/${id}/intent`, body),
  resolveAttention: (id: string) => request("POST", `/internal/attention/${id}/resolve`),
  setKillSwitch: (engaged: boolean) =>
    request("POST", "/internal/kill-switch", { engaged }),
  patchGuardrails: (patch: Record<string, number>) =>
    request("PATCH", "/internal/guardrails", patch),
  saveBrandKit: (kit: Record<string, string>) => request("PUT", "/internal/settings/brand-kit", kit),
  signOffPlaybook: (id: string) => request("POST", `/internal/playbooks/${id}/signoff`, {}),
};
