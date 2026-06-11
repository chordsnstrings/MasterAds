// Platform connections entered through the UI (W7). This module owns the
// structural catalog (which keys each channel needs and which env var each
// maps to) and the boot loader that exports stored values into the
// environment. Precedence: explicitly set env vars always win — App
// Platform-managed secrets keep working unchanged.
import type { Repos } from "@engine/db";
import type { Platform } from "./guardrails/approval.js";

export interface ConnectionField {
  /** Stable key inside platform_connections.credentials. */
  key: string;
  /** Environment variable the adapters read. */
  envVar: string;
  /** Masked everywhere after saving. */
  secret: boolean;
  required: boolean;
  /** True for the field that names WHICH ad account money runs under. */
  isAccountRef?: boolean;
}

export const CONNECTION_FIELDS: Record<Platform, ConnectionField[]> = {
  meta: [
    { key: "access_token", envVar: "META_ACCESS_TOKEN", secret: true, required: true },
    { key: "ad_account_id", envVar: "META_AD_ACCOUNT_ID", secret: false, required: true, isAccountRef: true },
    { key: "dataset_id", envVar: "META_DATASET_ID", secret: false, required: true },
  ],
  google: [
    { key: "developer_token", envVar: "GOOGLE_ADS_DEVELOPER_TOKEN", secret: true, required: true },
    { key: "customer_id", envVar: "GOOGLE_ADS_CUSTOMER_ID", secret: false, required: true, isAccountRef: true },
    { key: "oauth_client_id", envVar: "GOOGLE_OAUTH_CLIENT_ID", secret: false, required: true },
    { key: "oauth_client_secret", envVar: "GOOGLE_OAUTH_CLIENT_SECRET", secret: true, required: true },
    { key: "refresh_token", envVar: "GOOGLE_ADS_REFRESH_TOKEN", secret: true, required: true },
  ],
  tiktok: [
    { key: "access_token", envVar: "TIKTOK_ACCESS_TOKEN", secret: true, required: true },
    { key: "advertiser_id", envVar: "TIKTOK_ADVERTISER_ID", secret: false, required: true, isAccountRef: true },
    { key: "pixel_code", envVar: "TIKTOK_PIXEL_CODE", secret: false, required: true },
  ],
  snapchat: [
    { key: "access_token", envVar: "SNAPCHAT_ACCESS_TOKEN", secret: true, required: true },
    { key: "ad_account_id", envVar: "SNAPCHAT_AD_ACCOUNT_ID", secret: false, required: true, isAccountRef: true },
    { key: "pixel_id", envVar: "SNAPCHAT_PIXEL_ID", secret: false, required: true },
  ],
  pinterest: [
    { key: "access_token", envVar: "PINTEREST_ACCESS_TOKEN", secret: true, required: true },
    { key: "ad_account_id", envVar: "PINTEREST_AD_ACCOUNT_ID", secret: false, required: true, isAccountRef: true },
  ],
};

export const CONNECTION_PLATFORMS = Object.keys(CONNECTION_FIELDS) as Platform[];

// --- AI provider (P3) — connectable through the UI like the ad channels ----
export const AI_PROVIDERS = ["anthropic", "openai", "deepseek", "llama"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** Where each stored ai.* field lands per provider. */
const AI_ENV: Record<AiProvider, { key: string; model: string; baseUrl?: string }> = {
  anthropic: { key: "ANTHROPIC_API_KEY", model: "ANTHROPIC_MODEL" },
  openai: { key: "OPENAI_API_KEY", model: "OPENAI_MODEL", baseUrl: "OPENAI_BASE_URL" },
  deepseek: { key: "DEEPSEEK_API_KEY", model: "DEEPSEEK_MODEL", baseUrl: "DEEPSEEK_BASE_URL" },
  llama: { key: "LLAMA_API_KEY", model: "LLAMA_MODEL", baseUrl: "LLAMA_BASE_URL" },
};

export interface AiConnectionField {
  key: "provider" | "api_key" | "model" | "base_url" | "mode";
  secret: boolean;
  required: boolean;
  choices?: readonly string[];
}

export const AI_CONNECTION_FIELDS: AiConnectionField[] = [
  { key: "provider", secret: false, required: true, choices: AI_PROVIDERS },
  { key: "api_key", secret: true, required: true },
  { key: "model", secret: false, required: false },
  { key: "base_url", secret: false, required: false },
  { key: "mode", secret: false, required: false, choices: ["test", "live"] },
];

/** Missing/invalid fields for an AI connection after merging. */
export function missingAiRequired(merged: Record<string, string>): string[] {
  const missing: string[] = [];
  if (!AI_PROVIDERS.includes(merged.provider as AiProvider)) missing.push("provider");
  // Llama may point at an unauthenticated local host: base_url stands in.
  if (!merged.api_key?.trim() && !(merged.provider === "llama" && merged.base_url?.trim())) {
    missing.push("api_key");
  }
  return missing;
}

function applyAiConnection(credentials: Record<string, string>, applied: string[]): void {
  const provider = credentials.provider as AiProvider;
  if (!AI_PROVIDERS.includes(provider)) return;
  const env = AI_ENV[provider];
  const set = (envVar: string, value?: string): void => {
    if (value && !process.env[envVar]) {
      process.env[envVar] = value;
      applied.push(envVar);
    }
  };
  set("LLM_PROVIDER", provider);
  set(env.key, credentials.api_key);
  set(env.model, credentials.model);
  if (env.baseUrl) set(env.baseUrl, credentials.base_url);
  if (credentials.mode === "live") set("LLM_MODE", "live");
}

/** "abcd1234efgh" → "····efgh" — the only form a saved value ever leaves in. */
export function maskCredential(value: string): string {
  return value.length > 4 ? `····${value.slice(-4)}` : "····";
}

export function accountRefField(platform: Platform): ConnectionField | undefined {
  return CONNECTION_FIELDS[platform].find((f) => f.isAccountRef);
}

/** Missing required keys after merging an update onto the stored row. */
export function missingRequired(
  platform: Platform,
  merged: Record<string, string>,
): string[] {
  return CONNECTION_FIELDS[platform]
    .filter((f) => f.required && !merged[f.key]?.trim())
    .map((f) => f.key);
}

/**
 * Boot loader: export stored credentials into the environment for any var
 * not already set. Called by api/loops/scheduler before adapters are built,
 * so credentials entered in the UI feed the same code path as env secrets.
 */
export async function applyStoredConnections(
  repos: Repos,
): Promise<{ applied: string[] }> {
  const applied: string[] = [];
  for (const row of await repos.platformConnections.list()) {
    if (row.platform === "ai") {
      applyAiConnection(row.credentials, applied);
      continue;
    }
    for (const field of CONNECTION_FIELDS[row.platform as Platform] ?? []) {
      const value = row.credentials[field.key];
      if (value && !process.env[field.envVar]) {
        process.env[field.envVar] = value;
        applied.push(field.envVar);
      }
    }
  }
  return { applied };
}
