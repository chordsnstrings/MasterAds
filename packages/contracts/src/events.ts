// The inbound conversion contract (SW §7.1) — the single source of payload
// truth, imported by api, loops, and tests. Invariant 8: this contract is sacred.
import { z } from "zod";

// Canonical event taxonomy (SW Appendix A). Platform-specific names are
// normalized to these; never improvise event names.
export const CANONICAL_EVENTS = [
  "ViewContent",
  "AddToCart",
  "InitiateCheckout",
  "Purchase",
  "Lead",
  "CompleteRegistration",
  "Install",
] as const;
export type CanonicalEvent = (typeof CANONICAL_EVENTS)[number];

/** Inbound aliases → canonical name (SW Appendix A; case-tolerant). */
const EVENT_ALIASES: Record<string, CanonicalEvent> = {
  viewcontent: "ViewContent",
  page_view: "ViewContent",
  product_view: "ViewContent",
  addtocart: "AddToCart",
  add_to_cart: "AddToCart",
  initiatecheckout: "InitiateCheckout",
  begin_checkout: "InitiateCheckout",
  purchase: "Purchase",
  completepayment: "Purchase",
  complete_payment: "Purchase",
  lead: "Lead",
  submitform: "Lead",
  submit_form: "Lead",
  submit_lead_form: "Lead",
  contact: "Lead",
  completeregistration: "CompleteRegistration",
  complete_registration: "CompleteRegistration",
  subscribe: "CompleteRegistration",
  sign_up: "CompleteRegistration",
  install: "Install",
  app_install: "Install",
};

export function normalizeEventName(name: string): CanonicalEvent | undefined {
  return EVENT_ALIASES[name.toLowerCase().replace(/\s+/g, "_")];
}

/** Events that must carry value + currency (monetary). */
export const MONETARY_EVENTS: readonly CanonicalEvent[] = ["Purchase"];

const sha256Hex = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, "must be a lowercase SHA-256 hex digest (64 hex chars)");

export const clickIdsSchema = z
  .object({
    fbc: z.string().min(1).optional(),
    fbclid: z.string().min(1).optional(),
    fbp: z.string().min(1).optional(),
    ttclid: z.string().min(1).optional(),
    gclid: z.string().min(1).optional(),
    gbraid: z.string().min(1).optional(),
    wbraid: z.string().min(1).optional(),
    sccid: z.string().min(1).optional(),
    epik: z.string().min(1).optional(),
  })
  .strict();
export type ClickIdsPayload = z.infer<typeof clickIdsSchema>;

export const hashedIdentifiersSchema = z
  .object({
    email_sha256: sha256Hex.optional(),
    phone_sha256: sha256Hex.optional(),
    first_name_sha256: sha256Hex.optional(),
    last_name_sha256: sha256Hex.optional(),
    city_sha256: sha256Hex.optional(),
    zip_sha256: sha256Hex.optional(),
    country_sha256: sha256Hex.optional(),
    external_id_sha256: sha256Hex.optional(),
  })
  .strict();
export type HashedIdentifiersPayload = z.infer<typeof hashedIdentifiersSchema>;

export const conversionPayloadSchema = z
  .object({
    event_name: z
      .string()
      .min(1)
      .superRefine((name, ctx) => {
        if (!normalizeEventName(name)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `unknown event_name "${name}"; canonical taxonomy: ${CANONICAL_EVENTS.join(", ")} (platform aliases accepted)`,
          });
        }
      }),
    // Unix timestamp (seconds) of when the action occurred, not when sent.
    event_time: z
      .number()
      .int()
      .positive()
      .max(4102444800, "event_time must be unix seconds, not milliseconds"),
    value: z.number().nonnegative().optional(),
    currency: z
      .string()
      .length(3)
      .transform((c) => c.toUpperCase())
      .optional(),
    click_ids: clickIdsSchema.default({}),
    hashed_identifiers: hashedIdentifiersSchema.default({}),
    content_id: z.string().min(1),
    event_id: z.string().min(1),
    source_site: z.string().min(1),
    consent_granted: z.boolean().default(true),
    // Consent Mode v2 signals (Google): granular ads-data / personalization.
    consent: z
      .object({
        ad_user_data: z.boolean().optional(),
        ad_personalization: z.boolean().optional(),
      })
      .strict()
      .optional(),
    // Plain (non-hashed) browser/network signals for match quality.
    client_ip_address: z.string().min(3).max(64).optional(),
    client_user_agent: z.string().min(3).max(512).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const canonical = normalizeEventName(p.event_name);
    if (p.value !== undefined && p.currency === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currency"],
        message: "currency is required whenever value is present",
      });
    }
    if (canonical && MONETARY_EVENTS.includes(canonical) && p.value === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: `value is required on monetary event ${canonical}`,
      });
    }
  });

export type ConversionPayload = z.infer<typeof conversionPayloadSchema>;

/** Idempotency key (invariant 8): ingestion is idempotent on (source_site, event_id). */
export function dedupKey(p: Pick<ConversionPayload, "source_site" | "event_id">): string {
  return `${p.source_site}:${p.event_id}`;
}

/**
 * Cross-platform reconciliation key (SW §8.5): one real conversion claimed by
 * multiple platform paths collapses on event_id + identity.
 */
export function reconciliationKey(
  p: Pick<ConversionPayload, "event_name" | "event_id" | "hashed_identifiers">,
): string {
  const canonical = normalizeEventName(p.event_name) ?? p.event_name;
  const identity =
    p.hashed_identifiers?.email_sha256 ?? p.hashed_identifiers?.phone_sha256 ?? "anon";
  return `${canonical}:${p.event_id}:${identity}`;
}
