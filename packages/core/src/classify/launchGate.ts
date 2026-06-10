// Restricted gate (SW §10.5, invariant 9): a restricted spec cannot reach
// launch until its playbook's one-time compliance sign-off flag is set.
// The UI path for restricted specs is Submit for review, never Launch.
import type { CampaignSpec, Repos } from "@engine/db";

export type LaunchGateResult =
  | { allowed: true }
  | { allowed: false; reason: "requires_signoff" | "playbook_missing"; message: string };

export async function checkLaunchGate(
  repos: Repos,
  spec: CampaignSpec,
): Promise<LaunchGateResult> {
  if (spec.policyCategory !== "restricted") return { allowed: true };
  if (!spec.playbookId) {
    return {
      allowed: false,
      reason: "playbook_missing",
      message: "Restricted offers need an approved playbook before going live.",
    };
  }
  const playbook = await repos.playbooks.get(spec.playbookId);
  if (!playbook) {
    return {
      allowed: false,
      reason: "playbook_missing",
      message: "Restricted offers need an approved playbook before going live.",
    };
  }
  if (playbook.requiresSignoff && !playbook.signedOffAt) {
    return {
      allowed: false,
      reason: "requires_signoff",
      message:
        "Ads for this category need a quick check before they go live. Submit for review and we'll handle it.",
    };
  }
  return { allowed: true };
}
