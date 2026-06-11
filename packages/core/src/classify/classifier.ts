// Understanding / classification layer (SW §5.2): decide what the product is.
// LLM-backed (Anthropic) in live mode, deterministic fixture-backed in stub —
// the calling code path is identical. Never guess silently on low confidence
// (FLOW §4.5): below threshold the result is a single disambiguation question.
import { z } from "zod";
import type { Product } from "@engine/db";

/** Structural interface satisfied by @engine/adapters' LlmClient. */
export interface InferenceClient {
  complete(req: {
    operation: "classification" | "narration" | "creative_copy";
    system?: string;
    prompt: string;
    productId?: string | null;
    maxTokens?: number;
  }): Promise<{ text: string }>;
}

export const CONFIDENCE_THRESHOLD = 0.6;

const classificationSchema = z.object({
  vertical: z.string(),
  business_model: z.enum(["ecommerce", "lead_generation", "app", "subscription", "booking"]),
  terminal_event: z.string(),
  funnel_stages: z.array(z.string()),
  creative_angle: z.string(),
  policy_category: z.enum(["standard", "restricted"]),
  confidence: z.number().min(0).max(1),
});

export interface Classification {
  vertical: string;
  businessModel: "ecommerce" | "lead_generation" | "app" | "subscription" | "booking";
  terminalEvent: string;
  funnelStages: string[];
  priceTier: "low" | "mid" | "high" | "premium";
  creativeAngle: string;
  policyCategory: "standard" | "restricted";
  confidence: number;
  expectedWeeklyTerminalVolume: number;
}

export type ClassifyResult =
  | { kind: "classified"; classification: Classification }
  | { kind: "needs_disambiguation"; question: string };

export function priceTierOf(price: number | undefined): Classification["priceTier"] {
  if (price === undefined || Number.isNaN(price)) return "mid";
  if (price < 100) return "low";
  if (price < 1000) return "mid";
  if (price < 5000) return "high";
  return "premium";
}

/** Heuristic expected weekly terminal volume, used by event selection. */
export function estimateWeeklyTerminalVolume(
  businessModel: Classification["businessModel"],
  priceTier: Classification["priceTier"],
  mode: "catalog" | "offer",
): number {
  if (businessModel === "ecommerce" || businessModel === "subscription") {
    const base = { low: 90, mid: 40, high: 12, premium: 4 }[priceTier];
    return mode === "catalog" ? base : Math.max(2, Math.round(base / 2));
  }
  // Lead-style terminals convert at higher per-impression rates.
  return { low: 60, mid: 30, high: 15, premium: 8 }[priceTier];
}

const SYSTEM_PROMPT = `You classify a product or offer for an advertising engine.
Respond ONLY with JSON: {"vertical": string, "business_model": "ecommerce"|"lead_generation"|"app"|"subscription"|"booking", "terminal_event": "Purchase"|"Lead"|"CompleteRegistration"|"Install", "funnel_stages": string[], "creative_angle": string, "policy_category": "standard"|"restricted", "confidence": 0..1}.
Known verticals: ecommerce_physical_goods, local_services_leadgen, property_leadgen, restricted_finance. Use the closest; restricted_finance for financial services/credit/insurance/trading. Confidence below 0.6 means you genuinely cannot tell product vs service.`;

export function buildClassificationPrompt(
  product: Product,
  disambiguation?: "product" | "service",
): string {
  return [
    `title: ${product.title}`,
    `description: ${product.description ?? product.rawInput ?? ""}`,
    `price: ${product.price ?? "unknown"} ${product.currency ?? ""}`,
    `mode: ${product.mode}`,
    `category: ${product.category ?? "unknown"}`,
    disambiguation ? `hint: ${disambiguation} (the user answered the disambiguation question)` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const DISAMBIGUATION_QUESTION =
  "Is this closer to selling a product, or offering a service?";

export async function classifyProduct(
  llm: InferenceClient,
  product: Product,
  opts: { disambiguation?: "product" | "service" } = {},
): Promise<ClassifyResult> {
  const { text } = await llm.complete({
    operation: "classification",
    system: SYSTEM_PROMPT,
    prompt: buildClassificationPrompt(product, opts.disambiguation),
    productId: product.id,
    maxTokens: 500,
  });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("classifier returned no JSON");
  const parsed = classificationSchema.parse(JSON.parse(jsonMatch[0]));

  if (parsed.confidence < CONFIDENCE_THRESHOLD && !opts.disambiguation) {
    return { kind: "needs_disambiguation", question: DISAMBIGUATION_QUESTION };
  }

  // The owner's correction is binding (W8): it overrides the model, not just
  // hints at it — "Understood as" in Review must obey the human.
  if (opts.disambiguation === "product" && parsed.business_model !== "ecommerce") {
    parsed.business_model = "ecommerce";
    parsed.terminal_event = "Purchase";
    parsed.funnel_stages = ["ViewContent", "AddToCart", "InitiateCheckout", "Purchase"];
  } else if (
    opts.disambiguation === "service" &&
    parsed.business_model !== "lead_generation" &&
    parsed.business_model !== "booking"
  ) {
    parsed.business_model = "lead_generation";
    parsed.terminal_event = "Lead";
    parsed.funnel_stages = ["ViewContent", "Lead"];
  }

  const priceTier = priceTierOf(product.price !== null ? Number(product.price) : undefined);
  return {
    kind: "classified",
    classification: {
      vertical: parsed.vertical,
      businessModel: parsed.business_model,
      terminalEvent: parsed.terminal_event,
      funnelStages: parsed.funnel_stages,
      priceTier,
      creativeAngle: parsed.creative_angle,
      policyCategory: parsed.policy_category,
      confidence: parsed.confidence,
      expectedWeeklyTerminalVolume: estimateWeeklyTerminalVolume(
        parsed.business_model,
        priceTier,
        product.mode,
      ),
    },
  };
}
