// Guardrail approval primitive (invariant 1): no adapter write is reachable
// except via a guardrail-approved action object. Approval is an unforgeable
// in-process brand (module-private WeakSet) — code outside this module cannot
// construct an ApprovedAction, only receive one from the guardrail layer.
// The mutation-path audit (GATE G8) verifies `approveAction(` is called only here
// and in guardrails/execute.ts.

export type Platform = "meta" | "google" | "tiktok" | "snapchat" | "pinterest";

export interface CreateCampaignAction {
  type: "create_campaign";
  platform: Platform;
  specId: string;
  payload: {
    name: string;
    objective: "purchases" | "leads" | "registrations" | "installs" | "visits";
    optimizationEvent: string;
    dailyBudget: number;
    currency: string;
    destinationUrl: string;
    creativeIds: string[];
    contentIds: string[];
    policyCategory: "standard" | "restricted";
  };
}

export interface UpdateCampaignAction {
  type: "update_campaign";
  platform: Platform;
  campaignId: string;
  platformCampaignId: string;
  changes: { dailyBudget?: number };
}

export interface PauseResumeAction {
  type: "pause_campaign" | "resume_campaign";
  platform: Platform;
  campaignId: string;
  platformCampaignId: string;
}

export interface DuplicateCampaignAction {
  type: "duplicate_campaign";
  platform: Platform;
  campaignId: string;
  platformCampaignId: string;
  overrides: { name?: string; dailyBudget?: number };
}

export interface UploadCreativeAction {
  type: "upload_creative";
  platform: Platform;
  creativeId: string;
  assetRef: string;
  format: string;
  contentId: string;
}

export type PlatformAction =
  | CreateCampaignAction
  | UpdateCampaignAction
  | PauseResumeAction
  | DuplicateCampaignAction
  | UploadCreativeAction;

export interface ApprovedAction<T extends PlatformAction = PlatformAction> {
  readonly action: T;
  readonly decisionId: string;
  readonly approvedAt: Date;
}

const approvalRegistry = new WeakSet<object>();

/** INTERNAL to the guardrail layer. Do not call from anywhere else. */
export function approveAction<T extends PlatformAction>(
  action: T,
  decisionId: string,
): ApprovedAction<T> {
  const approved: ApprovedAction<T> = Object.freeze({
    action,
    decisionId,
    approvedAt: new Date(),
  });
  approvalRegistry.add(approved);
  return approved;
}

export function isApproved(candidate: object): boolean {
  return approvalRegistry.has(candidate);
}

/** Adapters call this at the top of every write. Throws on forgeries. */
export function assertApproved(candidate: object): void {
  if (!approvalRegistry.has(candidate)) {
    throw new Error(
      "platform mutation rejected: action object was not approved by the guardrail layer (invariant 1)",
    );
  }
}
