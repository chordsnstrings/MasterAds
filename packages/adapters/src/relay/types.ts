// Outbound conversion relay (SW §7.2): canonical event → platform payload.
import type { ConversionEvent } from "@engine/db";

export type Platform = "meta" | "google" | "tiktok";

export type RelayBuildResult =
  | { kind: "send"; payload: Record<string, unknown> }
  | { kind: "skip"; reason: string };

export interface ConversionRelay {
  readonly platform: Platform;
  readonly mode: "stub" | "live";
  /** Pure mapping from the canonical event to the exact platform payload. */
  buildPayload(event: ConversionEvent): RelayBuildResult;
  /**
   * Send the payload. Stub mode validates the exact payload shape against the
   * recorded platform schema and logs it; live mode performs the HTTP call.
   * The surrounding code path is identical in both modes.
   */
  send(payload: Record<string, unknown>): Promise<void>;
}
