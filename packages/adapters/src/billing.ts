// Billing / connection health adapter (G9): platform token validity and
// account billing status. Stub/live driver pattern; fixtures injectable.
import { driverMode, type DriverMode } from "./env.js";

export type Platform = "meta" | "google" | "tiktok";

export interface BillingHealth {
  platform: Platform;
  tokenValid: boolean;
  billingOk: boolean;
  /** Whether an automatic token refresh is possible for this platform. */
  canRefresh: boolean;
}

export interface BillingChecker {
  readonly mode: DriverMode;
  check(platform: Platform): Promise<BillingHealth>;
  /** Attempt self-repair; returns true when the token is valid again. */
  refreshToken(platform: Platform): Promise<boolean>;
}

export function createBillingChecker(opts?: {
  mode?: DriverMode;
  fixtures?: Partial<Record<Platform, Partial<BillingHealth> & { refreshSucceeds?: boolean }>>;
}): BillingChecker {
  const mode = opts?.mode ?? driverMode("BILLING_MODE");
  return {
    mode,
    async check(platform: Platform): Promise<BillingHealth> {
      if (mode === "stub") {
        const f = opts?.fixtures?.[platform];
        return {
          platform,
          tokenValid: f?.tokenValid ?? true,
          billingOk: f?.billingOk ?? true,
          canRefresh: f?.canRefresh ?? true,
        };
      }
      // Live: lightweight authenticated ping per platform (P5 credentials).
      throw new Error(`${platform} live billing check requires P5 credentials (see BLOCKED.md)`);
    },
    async refreshToken(platform: Platform): Promise<boolean> {
      if (mode === "stub") {
        return opts?.fixtures?.[platform]?.refreshSucceeds ?? true;
      }
      throw new Error(`${platform} live token refresh requires P5 credentials (see BLOCKED.md)`);
    },
  };
}
