// Pre-flight policy screening (SW §14 Phase One step 4): a screening pass over
// generated copy/visual descriptors against per-platform rule lists. Rules are
// DATA (policyRules.json, in-repo, extensible). A rejection stops the channel;
// screening is cheaper than handling. Failures produce plain-language reasons.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const ruleSchema = z.object({ pattern: z.string(), reason: z.string() });
const rulesFileSchema = z.record(z.array(ruleSchema));

export interface PolicyViolation {
  platform: string;
  pattern: string;
  reason: string;
  matchedText: string;
}

export type ScreeningResult = { passed: true } | { passed: false; violations: PolicyViolation[] };

let cachedRules: Record<string, { pattern: string; reason: string }[]> | undefined;

export function loadPolicyRules(): Record<string, { pattern: string; reason: string }[]> {
  if (!cachedRules) {
    const path = join(dirname(fileURLToPath(import.meta.url)), "policyRules.json");
    cachedRules = rulesFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  }
  return cachedRules;
}

/** Screen one creative concept (all its text surfaces) for the target platforms. */
export function screenCreative(
  texts: { headline?: string; body?: string; visualDescriptor?: string },
  platforms: string[],
): ScreeningResult {
  const rules = loadPolicyRules();
  const surfaces = [texts.headline, texts.body, texts.visualDescriptor].filter(
    (t): t is string => Boolean(t),
  );
  const applicable = ["common", ...platforms];
  const violations: PolicyViolation[] = [];
  for (const platform of applicable) {
    for (const rule of rules[platform] ?? []) {
      const re = new RegExp(rule.pattern, "i");
      for (const surface of surfaces) {
        const match = surface.match(re);
        if (match) {
          violations.push({
            platform: platform === "common" ? "all" : platform,
            pattern: rule.pattern,
            reason: rule.reason,
            matchedText: match[0],
          });
        }
      }
    }
  }
  return violations.length > 0 ? { passed: false, violations } : { passed: true };
}
