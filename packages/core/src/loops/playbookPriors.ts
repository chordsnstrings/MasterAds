// Self-updating playbook priors (W3.2 — formerly Phase Two, lifted): accrue
// conversion outcomes per (vertical, hook type) into performancePriors so
// creative generation leads with what actually works in each vertical.
import type { Repos } from "@engine/db";
import { HOOK_TYPES } from "../creative/generate.js";

export async function updatePlaybookPriors(
  repos: Repos,
  opts: { windowDays?: number; now?: Date } = {},
): Promise<{ updated: string[] }> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.windowDays ?? 30) * 86_400_000);
  const updated: string[] = [];
  if (await repos.killSwitch.isEngaged()) return { updated };

  const conversions = await repos.conversions.listCanonicalSince(since);
  const products = await repos.products.list();
  const playbooks = await repos.playbooks.list();

  for (const playbook of playbooks) {
    const verticalProducts = products.filter((p) => p.vertical === playbook.vertical);
    if (verticalProducts.length === 0) continue;

    const hookCredits = new Map<string, number>();
    let total = 0;
    for (const product of verticalProducts) {
      const productConversions = conversions.filter((e) => e.contentId === product.id).length;
      if (productConversions === 0) continue;
      const launched = (await repos.creatives.byProduct(product.id)).filter(
        (c) => c.status === "launched" && c.payload.hookType,
      );
      if (launched.length === 0) continue;
      // Credit each launched hook equally with the product's conversions.
      const share = productConversions / launched.length;
      for (const c of launched) {
        const key = `hook:${c.payload.hookType}`;
        hookCredits.set(key, (hookCredits.get(key) ?? 0) + share);
        total += share;
      }
    }
    if (total === 0) continue;

    // Normalize to 0..1 weights; keep non-hook priors untouched.
    const next: Record<string, number> = { ...playbook.performancePriors };
    for (const hook of HOOK_TYPES) next[`hook:${hook}`] = 0;
    for (const [key, credit] of hookCredits) {
      next[key] = Number((credit / total).toFixed(4));
    }
    await repos.playbooks.updatePriors(playbook.id, next);
    updated.push(playbook.vertical);

    const best = [...hookCredits.entries()].sort((a, b) => b[1] - a[1])[0];
    await repos.decisions.insert({
      loop: "slow",
      worker: "playbook-priors",
      actionType: "update_playbook_priors",
      targetRef: `playbook:${playbook.id}`,
      rationale: `Updated what works for ${playbook.vertical.replace(/_/g, " ")}: "${(best?.[0] ?? "").replace("hook:", "")}" openings are converting best, so new ads lead with them.`,
      evidence: [
        { metric: "conversions_credited", window: `${opts.windowDays ?? 30}d`, result: String(Math.round(total)) },
      ],
      guardrailStatus: "passed",
      executed: true,
    });
  }
  return { updated };
}
