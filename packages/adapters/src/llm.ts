// LLM adapter (stub/live driver, invariant 10). EVERY inference call emits an
// ai_inference CostEvent with units and price — enforced HERE, inside the
// adapter, so it cannot be skipped (invariant 4). Money is the unit; token
// counts never leave the ledger.
//
// Provider options (LLM_PROVIDER): anthropic (default) | openai | deepseek | llama.
// Claude uses the official Anthropic SDK against the native Messages API;
// openai/deepseek/llama share one OpenAI-compatible chat-completions driver
// (llama works with Groq, Together, Fireworks, vLLM, Ollama — any base URL).
import Anthropic from "@anthropic-ai/sdk";
import type { Repos } from "@engine/db";
import { driverMode, type DriverMode } from "./env.js";

export type LlmOperation = "classification" | "narration" | "creative_copy";
export type LlmProvider = "anthropic" | "openai" | "deepseek" | "llama";

export interface LlmRequest {
  operation: LlmOperation;
  system?: string;
  prompt: string;
  productId?: string | null;
  maxTokens?: number;
}

export interface LlmResponse {
  text: string;
}

export interface LlmClient {
  readonly mode: DriverMode;
  readonly provider: LlmProvider;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

// ---------------------------------------------------------------------------
// Pricing (USD per token). Defaults per provider/model; override via env so
// re-pricing is configuration, not code:
//   LLM_INPUT_PRICE_PER_MTOK / LLM_OUTPUT_PRICE_PER_MTOK
// ---------------------------------------------------------------------------
interface ProviderConfig {
  provider: LlmProvider;
  model: string;
  inputPricePerTok: number;
  outputPricePerTok: number;
  baseUrl?: string;
  apiKeyEnv: string;
}

const DEFAULT_PRICES_PER_MTOK: Record<LlmProvider, { input: number; output: number }> = {
  anthropic: { input: 3, output: 15 }, // claude-sonnet-4-6
  openai: { input: 0.15, output: 0.6 }, // gpt-4o-mini
  deepseek: { input: 0.27, output: 1.1 }, // deepseek-chat
  llama: { input: 0, output: 0 }, // often self-hosted; set overrides for hosted APIs
};

export function resolveProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const provider = (env.LLM_PROVIDER ?? "anthropic") as LlmProvider;
  if (!["anthropic", "openai", "deepseek", "llama"].includes(provider)) {
    throw new Error(`unknown LLM_PROVIDER "${env.LLM_PROVIDER}" (anthropic|openai|deepseek|llama)`);
  }
  const defaults = DEFAULT_PRICES_PER_MTOK[provider];
  const inputPerMtok = env.LLM_INPUT_PRICE_PER_MTOK ? Number(env.LLM_INPUT_PRICE_PER_MTOK) : defaults.input;
  const outputPerMtok = env.LLM_OUTPUT_PRICE_PER_MTOK ? Number(env.LLM_OUTPUT_PRICE_PER_MTOK) : defaults.output;
  const base = {
    inputPricePerTok: inputPerMtok / 1_000_000,
    outputPricePerTok: outputPerMtok / 1_000_000,
  };
  switch (provider) {
    case "anthropic":
      return {
        provider,
        model: env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        ...base,
      };
    case "openai":
      return {
        provider,
        model: env.OPENAI_MODEL ?? "gpt-4o-mini",
        baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        apiKeyEnv: "OPENAI_API_KEY",
        ...base,
      };
    case "deepseek":
      return {
        provider,
        model: env.DEEPSEEK_MODEL ?? "deepseek-chat",
        baseUrl: env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
        apiKeyEnv: "DEEPSEEK_API_KEY",
        ...base,
      };
    case "llama":
      return {
        provider,
        model: env.LLAMA_MODEL ?? "llama-3.3-70b",
        baseUrl: env.LLAMA_BASE_URL ?? "",
        apiKeyEnv: "LLAMA_API_KEY",
        ...base,
      };
  }
}

export type StubResponder = (req: LlmRequest) => string;

/** Deterministic stub classification: keyword rules, fixture-friendly. */
function stubClassification(prompt: string): string {
  const p = prompt.toLowerCase();
  const has = (...words: string[]) => words.some((w) => p.includes(w));

  let confidence = 0.92;
  let vertical = "ecommerce_physical_goods";
  let businessModel = "ecommerce";
  let policyCategory = "standard";

  if (has("loan", "credit", "insurance", "mortgage", "trading", "invest", "финанс", "finance")) {
    vertical = "restricted_finance";
    businessModel = "lead_generation";
    policyCategory = "restricted";
  } else if (has("villa", "apartment", "property", "real estate", "lease", "rent ", "tenant")) {
    vertical = "property_leadgen";
    businessModel = "lead_generation";
  } else if (has("install", "repair", "clean", "service", "book", "appointment", "treatment")) {
    vertical = "local_services_leadgen";
    businessModel = "lead_generation";
  } else if (has("subscription", "subscribe", "membership")) {
    vertical = "ecommerce_physical_goods";
    businessModel = "subscription";
  }

  // A vague brief gives the classifier nothing to anchor on → low confidence
  // unless the user already answered the product-vs-service question.
  const wordCount = (prompt.match(/description: ([^\n]*)/)?.[1] ?? "").split(/\s+/).filter(Boolean).length;
  const hasHint = has("hint: product", "hint: service");
  if (wordCount < 4 && !has("mode: catalog") && !hasHint) confidence = 0.4;
  if (has("hint: service") && vertical === "ecommerce_physical_goods") {
    vertical = "local_services_leadgen";
    businessModel = "lead_generation";
  }

  const terminalEvent = businessModel === "ecommerce" || businessModel === "subscription" ? "Purchase" : "Lead";
  const funnelStages =
    terminalEvent === "Purchase"
      ? ["ViewContent", "AddToCart", "InitiateCheckout", "Purchase"]
      : ["ViewContent", "Lead"];
  const creativeAngle =
    vertical === "property_leadgen"
      ? "aspirational_lifestyle"
      : vertical === "local_services_leadgen"
        ? "trust_expertise"
        : vertical === "restricted_finance"
          ? "clarity_trust"
          : "lifestyle";

  return JSON.stringify({
    vertical,
    business_model: businessModel,
    terminal_event: terminalEvent,
    funnel_stages: funnelStages,
    creative_angle: creativeAngle,
    policy_category: policyCategory,
    confidence,
  });
}

function defaultStubResponder(req: LlmRequest): string {
  if (req.operation === "classification") return stubClassification(req.prompt);
  if (req.operation === "narration") return "Plain-language summary unavailable in stub mode.";
  return JSON.stringify({
    variants: [
      { hook: "curiosity", headline: "The detail everyone asks about", body: "See why people keep coming back to this one.", scenes: ["Close-up on the detail nobody expects", "Pull back to reveal the whole product", "The detail everyone asks about — see it yourself"] },
      { hook: "social_proof", headline: "Loved by thousands", body: "Join happy customers across the region.", scenes: ["Quick cuts of happy customers using it", "Star ratings and real quotes appear", "Loved by thousands — join them"] },
      { hook: "benefit", headline: "Made for every day", body: "Quality you can feel. Delivered to your door.", scenes: ["Morning-to-night moments with the product", "The one benefit that changes the day", "Made for every day — delivered to your door"] },
      { hook: "contrarian", headline: "Skip the usual compromise", body: "Most options make you choose. This one doesn't.", scenes: ["Side-by-side with the usual compromise", "Cross out the trade-off on screen", "Skip the compromise — get both"] },
      { hook: "urgency", headline: "Ready when you are", body: "Fast delivery while stock lasts.", scenes: ["Box arriving at the door, timer on screen", "Stock counter ticking down", "Ready when you are — while stock lasts"] },
      { hook: "sensory", headline: "Feel the difference", body: "Crafted to look and feel exactly right.", scenes: ["Macro texture shots in slow motion", "Hands running over the surface", "Feel the difference — up close"] },
    ],
  });
}

// ---------------------------------------------------------------------------
// Live drivers
// ---------------------------------------------------------------------------
async function completeAnthropic(
  config: ProviderConfig,
  apiKey: string,
  req: LlmRequest,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const anthropic = new Anthropic({ apiKey });
  const response = await anthropic.messages.create({
    model: config.model,
    max_tokens: req.maxTokens ?? 1024,
    ...(req.system ? { system: req.system } : {}),
    messages: [{ role: "user", content: req.prompt }],
  });
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

/** OpenAI-compatible chat completions: OpenAI, DeepSeek, Llama hosts. */
async function completeOpenAiCompatible(
  config: ProviderConfig,
  apiKey: string,
  req: LlmRequest,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  if (!config.baseUrl) {
    throw new Error(
      `${config.provider} live mode needs a base URL (set ${config.provider.toUpperCase()}_BASE_URL)`,
    );
  }
  const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: req.maxTokens ?? 1024,
      messages: [
        ...(req.system ? [{ role: "system", content: req.system }] : []),
        { role: "user", content: req.prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${config.provider} ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as {
    choices: { message: { content: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: body.choices[0]?.message.content ?? "",
    inputTokens: body.usage?.prompt_tokens ?? 0,
    outputTokens: body.usage?.completion_tokens ?? 0,
  };
}

export function createLlmClient(opts: {
  repos: Repos;
  mode?: DriverMode;
  responder?: StubResponder;
  provider?: LlmProvider;
}): LlmClient {
  const mode = opts.mode ?? driverMode("LLM_MODE");
  const { repos } = opts;
  const config = resolveProviderConfig(
    opts.provider ? { ...process.env, LLM_PROVIDER: opts.provider } : process.env,
  );

  async function emitCost(
    req: LlmRequest,
    inputTokens: number,
    outputTokens: number,
    model: string,
    provider: string,
  ): Promise<void> {
    const amount =
      inputTokens * config.inputPricePerTok + outputTokens * config.outputPricePerTok;
    await repos.costs.insert({
      costType: "ai_inference",
      operation: req.operation,
      providerOrPlatform: provider,
      model,
      units: { input_tokens: inputTokens, output_tokens: outputTokens },
      unitPrice: config.outputPricePerTok.toFixed(8),
      amount: amount.toFixed(6),
      currency: "USD",
      productId: req.productId ?? null,
      occurredAt: new Date(),
    });
  }

  return {
    mode,
    provider: config.provider,
    async complete(req: LlmRequest): Promise<LlmResponse> {
      if (mode === "stub") {
        const text = (opts.responder ?? defaultStubResponder)(req);
        const inputTokens = Math.ceil((req.system ?? "").length / 4 + req.prompt.length / 4);
        const outputTokens = Math.ceil(text.length / 4);
        await emitCost(req, inputTokens, outputTokens, "stub-llm-1", "stub-llm");
        return { text };
      }

      const apiKey = process.env[config.apiKeyEnv];
      if (!apiKey && config.provider !== "llama") {
        // Llama may point at an unauthenticated local endpoint (vLLM/Ollama).
        throw new Error(`${config.apiKeyEnv} required for LLM_PROVIDER=${config.provider} in live mode`);
      }

      const result =
        config.provider === "anthropic"
          ? await completeAnthropic(config, apiKey!, req)
          : await completeOpenAiCompatible(config, apiKey ?? "", req);

      await emitCost(req, result.inputTokens, result.outputTokens, config.model, config.provider);
      return { text: result.text };
    },
  };
}
