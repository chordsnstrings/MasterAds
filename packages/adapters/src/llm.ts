// LLM adapter (stub/live driver, invariant 10). EVERY inference call emits an
// ai_inference CostEvent with units and price — enforced HERE, inside the
// adapter, so it cannot be skipped (invariant 4). Money is the unit; token
// counts never leave the ledger.
import type { Repos } from "@engine/db";
import { driverMode, type DriverMode } from "./env.js";

export type LlmOperation = "classification" | "narration" | "creative_copy";

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
  complete(req: LlmRequest): Promise<LlmResponse>;
}

// USD per token (claude-sonnet pricing) — used to price the ledger rows.
const INPUT_PRICE = 3 / 1_000_000;
const OUTPUT_PRICE = 15 / 1_000_000;

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
      { headline: "Made for every day", body: "Quality you can feel. Delivered to your door." },
      { headline: "Loved by thousands", body: "Join happy customers across the region." },
      { headline: "Start today", body: "Simple, fast, and built around you." },
    ],
  });
}

export function createLlmClient(opts: {
  repos: Repos;
  mode?: DriverMode;
  responder?: StubResponder;
}): LlmClient {
  const mode = opts.mode ?? driverMode("LLM_MODE");
  const { repos } = opts;

  async function emitCost(req: LlmRequest, inputTokens: number, outputTokens: number, model: string, provider: string): Promise<void> {
    const amount = inputTokens * INPUT_PRICE + outputTokens * OUTPUT_PRICE;
    await repos.costs.insert({
      costType: "ai_inference",
      operation: req.operation,
      providerOrPlatform: provider,
      model,
      units: { input_tokens: inputTokens, output_tokens: outputTokens },
      unitPrice: OUTPUT_PRICE.toFixed(8),
      amount: amount.toFixed(6),
      currency: "USD",
      productId: req.productId ?? null,
      occurredAt: new Date(),
    });
  }

  return {
    mode,
    async complete(req: LlmRequest): Promise<LlmResponse> {
      if (mode === "stub") {
        const text = (opts.responder ?? defaultStubResponder)(req);
        const inputTokens = Math.ceil((req.system ?? "").length / 4 + req.prompt.length / 4);
        const outputTokens = Math.ceil(text.length / 4);
        await emitCost(req, inputTokens, outputTokens, "stub-llm-1", "stub-llm");
        return { text };
      }
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY required in live mode");
      const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: req.maxTokens ?? 1024,
          system: req.system,
          messages: [{ role: "user", content: req.prompt }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as {
        content: { type: string; text?: string }[];
        usage: { input_tokens: number; output_tokens: number };
      };
      const text = body.content.find((c) => c.type === "text")?.text ?? "";
      await emitCost(req, body.usage.input_tokens, body.usage.output_tokens, model, "anthropic");
      return { text };
    },
  };
}
