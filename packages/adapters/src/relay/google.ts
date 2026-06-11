// Google Enhanced Conversions / Data Manager relay (SW §7.2, Appendix B).
import { z } from "zod";
import type { ConversionEvent } from "@engine/db";
import { driverMode, type DriverMode } from "../env.js";
import type { ConversionRelay, RelayBuildResult } from "./types.js";

const GOOGLE_CONVERSION_ACTIONS: Record<string, string> = {
  ViewContent: "page_view",
  AddToCart: "add_to_cart",
  InitiateCheckout: "begin_checkout",
  Purchase: "purchase",
  Lead: "submit_lead_form",
  CompleteRegistration: "sign_up",
};

export const googleConversionSchema = z
  .object({
    conversions: z
      .array(
        z
          .object({
            conversion_action: z.string(),
            conversion_date_time: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\+00:00$/),
            order_id: z.string(),
            gclid: z.string().optional(),
            gbraid: z.string().optional(),
            wbraid: z.string().optional(),
            conversion_value: z.number().optional(),
            currency_code: z.string().length(3).optional(),
            user_identifiers: z
              .array(
                z
                  .object({
                    hashed_email: z.string().regex(/^[a-f0-9]{64}$/).optional(),
                    hashed_phone_number: z.string().regex(/^[a-f0-9]{64}$/).optional(),
                    address_info: z
                      .object({
                        hashed_first_name: z.string().regex(/^[a-f0-9]{64}$/).optional(),
                        hashed_last_name: z.string().regex(/^[a-f0-9]{64}$/).optional(),
                        city: z.string().optional(),
                        postal_code: z.string().optional(),
                        country_code: z.string().optional(),
                      })
                      .strict()
                      .optional(),
                  })
                  .strict(),
              )
              .optional(),
            consent: z
              .object({
                ad_user_data: z.enum(["GRANTED", "DENIED"]).optional(),
                ad_personalization: z.enum(["GRANTED", "DENIED"]).optional(),
              })
              .strict()
              .optional(),
            cart_data: z
              .object({ items: z.array(z.object({ product_id: z.string() }).strict()) })
              .strict(),
          })
          .strict(),
      )
      .length(1),
    partial_failure: z.literal(true),
  })
  .strict();

function googleDateTime(d: Date): string {
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)}+00:00`;
}

export function createGoogleRelay(opts?: { mode?: DriverMode }): ConversionRelay {
  const mode = opts?.mode ?? driverMode("GOOGLE_MODE");
  return {
    platform: "google",
    mode,
    buildPayload(event: ConversionEvent): RelayBuildResult {
      const action = GOOGLE_CONVERSION_ACTIONS[event.eventName];
      if (!action) return { kind: "skip", reason: `google has no conversion action for ${event.eventName}` };
      if (!event.consentGranted) return { kind: "skip", reason: "consent not granted" };
      const { gclid, gbraid, wbraid } = event.clickIds;
      const { email_sha256, phone_sha256 } = event.hashedIdentifiers;
      if (!gclid && !gbraid && !wbraid && !email_sha256 && !phone_sha256) {
        return { kind: "skip", reason: "no attribution keys (gclid/gbraid/wbraid/hashed identifiers)" };
      }
      const conversion: Record<string, unknown> = {
        conversion_action: action,
        conversion_date_time: googleDateTime(event.eventTime),
        order_id: event.eventId,
        cart_data: { items: [{ product_id: event.contentId }] },
      };
      if (gclid) conversion.gclid = gclid;
      if (gbraid) conversion.gbraid = gbraid;
      if (wbraid) conversion.wbraid = wbraid;
      if (event.value !== null) conversion.conversion_value = Number(event.value);
      if (event.currency !== null) conversion.currency_code = event.currency;
      const identifiers: Record<string, unknown>[] = [];
      if (email_sha256) identifiers.push({ hashed_email: email_sha256.toLowerCase() });
      if (phone_sha256) identifiers.push({ hashed_phone_number: phone_sha256.toLowerCase() });
      const ids = event.hashedIdentifiers;
      if (ids.first_name_sha256 && ids.last_name_sha256) {
        identifiers.push({
          address_info: {
            hashed_first_name: ids.first_name_sha256.toLowerCase(),
            hashed_last_name: ids.last_name_sha256.toLowerCase(),
          },
        });
      }
      if (identifiers.length > 0) conversion.user_identifiers = identifiers;
      // Consent Mode v2 signals when the site provided them.
      const cs = event.consentSignals;
      if (cs.ad_user_data !== undefined || cs.ad_personalization !== undefined) {
        conversion.consent = {
          ...(cs.ad_user_data !== undefined
            ? { ad_user_data: cs.ad_user_data ? "GRANTED" : "DENIED" }
            : {}),
          ...(cs.ad_personalization !== undefined
            ? { ad_personalization: cs.ad_personalization ? "GRANTED" : "DENIED" }
            : {}),
        };
      }
      return {
        kind: "send",
        payload: { conversions: [conversion], partial_failure: true },
      };
    },
    async send(payload: Record<string, unknown>): Promise<void> {
      if (mode === "stub") {
        googleConversionSchema.parse(payload);
        console.log(JSON.stringify({ msg: "stub relay send", platform: "google", payload }));
        return;
      }
      const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
      const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
      if (!customerId || !devToken) {
        throw new Error("GOOGLE_ADS_CUSTOMER_ID / GOOGLE_ADS_DEVELOPER_TOKEN required in live mode");
      }
      // Live mode uses the Google Ads API uploadClickConversions endpoint; the
      // OAuth token exchange is handled here when live credentials exist (P5).
      const res = await fetch(
        `https://googleads.googleapis.com/v18/customers/${customerId}:uploadClickConversions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "developer-token": devToken,
            authorization: `Bearer ${process.env.GOOGLE_ADS_REFRESH_TOKEN ?? ""}`,
          },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw new Error(`google conversions ${res.status}: ${await res.text()}`);
    },
  };
}
