// Conversion ingestion (SW §7.1, §8.4-8.6). Validated payload → normalized,
// reconciled, idempotent persist into the canonical store.
import {
  dedupKey,
  normalizeEventName,
  reconciliationKey,
  type ConversionPayload,
} from "@engine/contracts";
import type { ConversionEvent, Repos } from "@engine/db";

export interface IngestResult {
  event: ConversionEvent;
  duplicate: boolean;
  canonical: boolean;
}

/**
 * Persist one validated conversion payload.
 * - Idempotent on (source_site, event_id): replays return the existing row.
 * - Cross-platform reconciliation (SW §8.5): a conversion already claimed under
 *   the same reconciliation key (event_id + identity) by another path is stored
 *   as a non-canonical claim, so platform claims are reconciled, never summed.
 * - Late/out-of-order events accepted: event_time (occurred) and received_at
 *   are both kept.
 */
export async function ingestConversion(
  repos: Repos,
  payload: ConversionPayload,
): Promise<IngestResult> {
  const canonicalName = normalizeEventName(payload.event_name);
  if (!canonicalName) throw new Error(`unknown event_name ${payload.event_name}`);

  const reconKey = reconciliationKey(payload);
  const existingClaims = await repos.conversions.byReconciliationKey(reconKey);
  const isCanonical = existingClaims.length === 0;

  const { event, duplicate } = await repos.conversions.insertIdempotent({
    eventName: canonicalName,
    eventTime: new Date(payload.event_time * 1000),
    value: payload.value !== undefined ? payload.value.toFixed(4) : null,
    currency: payload.currency ?? null,
    contentId: payload.content_id,
    clickIds: payload.click_ids,
    hashedIdentifiers: payload.hashed_identifiers,
    eventId: payload.event_id,
    sourceSite: payload.source_site,
    consentGranted: payload.consent_granted,
    clientInfo: {
      ...(payload.client_ip_address ? { ip: payload.client_ip_address } : {}),
      ...(payload.client_user_agent ? { user_agent: payload.client_user_agent } : {}),
    },
    consentSignals: payload.consent ?? {},
    dedupKey: dedupKey(payload),
    reconciliationKey: reconKey,
    canonical: isCanonical,
  });

  return { event, duplicate, canonical: event.canonical };
}
