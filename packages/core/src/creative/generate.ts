// Creative generation pipeline (SW §5.4, GOALS G6): Product + creative angle →
// copy variants (LLM) + image briefs → assets in all placement formats,
// content_id stamped on every asset, policy-screened pre-flight, predictive
// pre-screening gating launch vs held, regeneration capped per product/period.
import { z } from "zod";
import type { CampaignSpec, Creative, Product, Repos } from "@engine/db";
import type { InferenceClient } from "../classify/classifier.js";
import { screenCreative, type PolicyViolation } from "./policy.js";
import { heuristicScorer, LAUNCH_SCORE_THRESHOLD, type PredictiveScorer } from "./scoring.js";

export const CREATIVE_FORMATS = ["1:1", "9:16", "16:9"] as const;
export type CreativeFormat = (typeof CREATIVE_FORMATS)[number];

/** Structural subset of @engine/adapters' CreativeProvider. */
export interface AssetProvider {
  generateImage(brief: {
    productId: string;
    prompt: string;
    format: CreativeFormat;
  }): Promise<{ assetRef: string; width: number; height: number }>;
}

export interface RegenerationCap {
  /** Max creative rows per product per rolling period (SW §10.2). */
  maxVariantRowsPerPeriod: number;
  periodDays: number;
}

export const DEFAULT_REGENERATION_CAP: RegenerationCap = {
  maxVariantRowsPerPeriod: 36,
  periodDays: 7,
};

const copySchema = z.object({
  variants: z
    .array(z.object({ headline: z.string().min(1), body: z.string().min(1) }))
    .min(1),
});

export type GenerateResult =
  | {
      kind: "generated";
      creatives: Creative[];
      blocked: { headline: string; violations: PolicyViolation[] }[];
    }
  | { kind: "cap_exceeded"; message: string }
  | { kind: "all_blocked"; blocked: { headline: string; violations: PolicyViolation[] }[] };

export async function getRegenerationCap(repos: Repos): Promise<RegenerationCap> {
  const stored = await repos.settings.get<{ maxVariantRowsPerPeriod: number; periodDays: number }>(
    "creative_caps",
  );
  return stored ?? DEFAULT_REGENERATION_CAP;
}

export async function generateCreatives(
  deps: { repos: Repos; llm: InferenceClient; provider: AssetProvider; scorer?: PredictiveScorer },
  product: Product,
  spec: CampaignSpec,
  opts: { variantCount?: number; cap?: RegenerationCap } = {},
): Promise<GenerateResult> {
  const { repos, llm, provider } = deps;
  const scorer = deps.scorer ?? heuristicScorer;
  const cap = opts.cap ?? (await getRegenerationCap(repos));
  const variantCount = opts.variantCount ?? 3;

  // Regeneration cap (operating-cost analogue of runaway ad spend).
  const periodStart = new Date(Date.now() - cap.periodDays * 86_400_000);
  const existing = await repos.creatives.countByProductSince(product.id, periodStart);
  if (existing + variantCount * CREATIVE_FORMATS.length > cap.maxVariantRowsPerPeriod) {
    return {
      kind: "cap_exceeded",
      message: `Creative generation for this product is capped at ${cap.maxVariantRowsPerPeriod} assets per ${cap.periodDays} days; try again later or raise the cap in Settings.`,
    };
  }

  // 1) Copy variants from the LLM (CostEvent emitted inside the adapter).
  const { text } = await llm.complete({
    operation: "creative_copy",
    system:
      'You write ad copy. Respond ONLY with JSON {"variants":[{"headline":string,"body":string}]} — no platform jargon, plain confident language.',
    prompt: [
      `product: ${product.title}`,
      `description: ${product.description ?? product.rawInput ?? ""}`,
      `price: ${product.price ?? "n/a"} ${product.currency ?? ""}`,
      `angle: ${spec.creativeAngle}`,
      `variants: ${variantCount}`,
    ].join("\n"),
    productId: product.id,
    maxTokens: 1024,
  });
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("copy generation returned no JSON");
  const { variants } = copySchema.parse(JSON.parse(jsonMatch[0]));

  // 2) Pre-flight policy screening per concept across target platforms.
  const platforms = spec.targetPlatforms;
  const blocked: { headline: string; violations: PolicyViolation[] }[] = [];
  const passing: { headline: string; body: string; visualDescriptor: string }[] = [];
  for (const v of variants.slice(0, variantCount)) {
    const visualDescriptor = `${spec.creativeAngle.replace(/_/g, " ")} shot of ${product.title}`;
    const screening = screenCreative(
      { headline: v.headline, body: v.body, visualDescriptor },
      platforms,
    );
    if (screening.passed) {
      passing.push({ ...v, visualDescriptor });
    } else {
      blocked.push({ headline: v.headline, violations: screening.violations });
    }
  }
  if (passing.length === 0) return { kind: "all_blocked", blocked };

  // 3) Render every passing concept to all placement formats; stamp content_id.
  const startVariantNo =
    (await repos.creatives.byProduct(product.id)).reduce((m, c) => Math.max(m, c.variantNo), 0) + 1;
  const creatives: Creative[] = [];
  let variantNo = startVariantNo;
  for (const concept of passing) {
    const score = scorer.score(concept, { creativeAngle: spec.creativeAngle });
    const status = score >= LAUNCH_SCORE_THRESHOLD ? "ready" : "held";
    for (const format of CREATIVE_FORMATS) {
      const asset = await provider.generateImage({
        productId: product.id,
        prompt: `${concept.visualDescriptor} — ${concept.headline}`,
        format,
      });
      creatives.push(
        await repos.creatives.insert({
          productId: product.id,
          variantNo,
          format,
          assetType: "image",
          assetRef: asset.assetRef,
          payload: {
            headline: concept.headline,
            body: concept.body,
            visualDescriptor: concept.visualDescriptor,
            width: String(asset.width),
            height: String(asset.height),
          },
          contentId: product.id, // threaded through campaign construction (G7)
          predictedScore: score.toFixed(4),
          status,
          priceBearing: /\d/.test(concept.headline + concept.body),
        }),
      );
    }
    variantNo++;
  }
  return { kind: "generated", creatives, blocked };
}
