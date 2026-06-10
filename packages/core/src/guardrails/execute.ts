// guardedExecute — the ONLY path from a proposed platform mutation to an
// adapter write. Order is fixed and non-negotiable:
//   1. kill switch          (invariant 2 — checked before every adapter write)
//   2. deterministic rules  (invariant 1 — pre-action, never post-hoc)
//   3. Decision persisted   (invariant 3 — written BEFORE execution)
//   4. approve + execute    (only on passed, never in dry-run)
import type { Decision, Repos } from "@engine/db";
import {
  approveAction,
  type ApprovedAction,
  type PlatformAction,
} from "./approval.js";
import { getGuardrailConfig } from "./config.js";
import { evaluateAction, type GuardrailContext } from "./rules.js";

export interface GuardedProposal<T extends PlatformAction> {
  loop: "fast" | "medium" | "slow" | "system";
  worker: string;
  actionType: string;
  targetRef: string;
  rationale: string;
  evidence?: { metric: string; window: string; result: string }[];
  predictedOutcome?: string;
  productId?: string | null;
  action: T;
  context?: GuardrailContext;
  /** Propose-only: Decision written with executed=false, nothing mutates. */
  dryRun?: boolean;
}

export interface GuardedResult<R> {
  decision: Decision;
  executed: boolean;
  result?: R;
  blockedReasons?: string[];
}

export async function guardedExecute<T extends PlatformAction, R>(
  repos: Repos,
  proposal: GuardedProposal<T>,
  execute: (approved: ApprovedAction<T>) => Promise<R>,
): Promise<GuardedResult<R>> {
  // 1) Kill switch halts all platform writes within one iteration.
  const killEngaged = await repos.killSwitch.isEngaged();

  // 2) Deterministic pre-action validation.
  const config = await getGuardrailConfig(repos);
  const verdict = killEngaged
    ? { verdict: "blocked" as const, violations: ["kill switch is engaged"] }
    : evaluateAction(proposal.action, config, proposal.context);

  const willExecute = verdict.verdict === "passed" && !proposal.dryRun;

  // 3) Decision persisted BEFORE execution (insert-only stream).
  const decision = await repos.decisions.insert({
    loop: proposal.loop,
    worker: proposal.worker,
    actionType: proposal.actionType,
    targetRef: proposal.targetRef,
    rationale:
      verdict.verdict === "blocked"
        ? `${proposal.rationale} [blocked: ${verdict.violations.join("; ")}]`
        : proposal.rationale,
    evidence: proposal.evidence ?? [],
    predictedOutcome: proposal.predictedOutcome ?? null,
    guardrailStatus: verdict.verdict,
    executed: willExecute,
    productId: proposal.productId ?? null,
  });

  if (!willExecute) {
    return {
      decision,
      executed: false,
      blockedReasons: verdict.verdict === "blocked" ? verdict.violations : undefined,
    };
  }

  // 4) Approve (unforgeable brand) and execute.
  const approved = approveAction(proposal.action, decision.id);
  const result = await execute(approved);
  return { decision, executed: true, result };
}
