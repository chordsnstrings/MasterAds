// Playbook engine (SW §5.2): playbooks are versioned DATA (DB rows seeded from
// JSON in-repo), selected by classification, never hardcoded vertical logic.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Playbook, Repos } from "@engine/db";

const seedSchema = z.array(
  z.object({
    vertical: z.string(),
    version: z.number().int(),
    objective: z.string(),
    funnelEvents: z.array(z.string()),
    creativeAngles: z.array(z.string()),
    formatMix: z.array(z.string()),
    audienceStrategy: z.string(),
    complianceConstraints: z.array(z.string()),
    performancePriors: z.record(z.number()),
    targetPlatforms: z.array(z.string()),
    requiresSignoff: z.boolean(),
  }),
);

export function loadPlaybookSeeds(): z.infer<typeof seedSchema> {
  const path = join(dirname(fileURLToPath(import.meta.url)), "seeds.json");
  return seedSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Idempotent: existing verticals are kept (playbooks improve via new versions). */
export async function seedPlaybooks(repos: Repos): Promise<Playbook[]> {
  const out: Playbook[] = [];
  for (const seed of loadPlaybookSeeds()) {
    out.push(
      await repos.playbooks.upsertByVertical({
        ...seed,
        status: "active",
      }),
    );
  }
  return out;
}

/** Select the playbook for a classified vertical; generic fallback is the
 * e-commerce playbook for product-like things, services for offer-like. */
export async function selectPlaybook(
  repos: Repos,
  vertical: string,
  businessModel: string,
): Promise<Playbook> {
  const direct = await repos.playbooks.byVertical(vertical);
  if (direct) return direct;
  const fallback =
    businessModel === "ecommerce" || businessModel === "subscription"
      ? "ecommerce_physical_goods"
      : "local_services_leadgen";
  const pb = await repos.playbooks.byVertical(fallback);
  if (!pb) throw new Error(`no playbook for ${vertical} and fallback ${fallback} missing — run seedPlaybooks`);
  return pb;
}
