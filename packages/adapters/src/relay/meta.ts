// Meta Conversions API relay (SW §7.2, Appendix B).
import { z } from "zod";
import type { ConversionEvent } from "@engine/db";
import { driverMode, type DriverMode } from "../env.js";
import type { ConversionRelay, RelayBuildResult } from "./types.js";

const META_EVENT_NAMES: Record<string, string> = {
  ViewContent: "ViewContent",
  AddToCart: "AddToCart",
  InitiateCheckout: "InitiateCheckout",
  Purchase: "Purchase",
  Lead: "Lead",
  CompleteRegistration: "CompleteRegistration",
};

// Recorded platform schema used by the stub driver to validate the exact
// outbound payload shape.
export const metaCapiSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            event_name: z.string(),
            event_time: z.number().int(),
            event_id: z.string(),
            action_source: z.literal("website"),
            user_data: z
              .object({
                em: z.array(z.string().regex(/^[a-f0-9]{64}$/)).optional(),
                ph: z.array(z.string().regex(/^[a-f0-9]{64}$/)).optional(),
                fn: z.array(z.string().regex(/^[a-f0-9]{64}$/)).optional(),
                ln: z.array(z.string().regex(/^[a-f0-9]{64}$/)).optional(),
                ct: z.array(z.string().regex(/^[a-f0-9]{64}$/)).optional(),
                zp: z.array(z.string().regex(/^[a-f0-9]{64}$/)).optional(),
                country: z.array(z.string().regex(/^[a-f0-9]{64}$/)).optional(),
                external_id: z.array(z.string().regex(/^[a-f0-9]{64}$/)).optional(),
                client_ip_address: z.string().optional(),
                client_user_agent: z.string().optional(),
                fbc: z.string().optional(),
                fbp: z.string().optional(),
              })
              .strict(),
            custom_data: z
              .object({
                value: z.number().optional(),
                currency: z.string().length(3).optional(),
                content_ids: z.array(z.string()),
              })
              .strict(),
          })
          .strict(),
      )
      .length(1),
  })
  .strict();

/** Derive fbc from a raw fbclid per Meta's documented format. */
function deriveFbc(event: ConversionEvent): string | undefined {
  const { fbc, fbclid } = event.clickIds;
  if (fbc) return fbc;
  if (fbclid) return `fb.1.${event.eventTime.getTime()}.${fbclid}`;
  return undefined;
}

export function createMetaRelay(opts?: { mode?: DriverMode }): ConversionRelay {
  const mode = opts?.mode ?? driverMode("META_MODE");
  return {
    platform: "meta",
    mode,
    buildPayload(event: ConversionEvent): RelayBuildResult {
      const name = META_EVENT_NAMES[event.eventName];
      if (!name) return { kind: "skip", reason: `meta does not accept ${event.eventName} via web CAPI` };
      if (!event.consentGranted) return { kind: "skip", reason: "consent not granted" };
      const fbc = deriveFbc(event);
      const { fbp } = event.clickIds;
      const { email_sha256, phone_sha256 } = event.hashedIdentifiers;
      if (!fbc && !fbp && !email_sha256 && !phone_sha256) {
        return { kind: "skip", reason: "no attribution keys (fbc/fbp/hashed identifiers)" };
      }
      const ids = event.hashedIdentifiers;
      const user_data: Record<string, unknown> = {};
      if (email_sha256) user_data.em = [email_sha256.toLowerCase()];
      if (phone_sha256) user_data.ph = [phone_sha256.toLowerCase()];
      if (ids.first_name_sha256) user_data.fn = [ids.first_name_sha256.toLowerCase()];
      if (ids.last_name_sha256) user_data.ln = [ids.last_name_sha256.toLowerCase()];
      if (ids.city_sha256) user_data.ct = [ids.city_sha256.toLowerCase()];
      if (ids.zip_sha256) user_data.zp = [ids.zip_sha256.toLowerCase()];
      if (ids.country_sha256) user_data.country = [ids.country_sha256.toLowerCase()];
      if (ids.external_id_sha256) user_data.external_id = [ids.external_id_sha256.toLowerCase()];
      if (event.clientInfo.ip) user_data.client_ip_address = event.clientInfo.ip;
      if (event.clientInfo.user_agent) user_data.client_user_agent = event.clientInfo.user_agent;
      if (fbc) user_data.fbc = fbc;
      if (fbp) user_data.fbp = fbp;
      const custom_data: Record<string, unknown> = { content_ids: [event.contentId] };
      if (event.value !== null) custom_data.value = Number(event.value);
      if (event.currency !== null) custom_data.currency = event.currency;
      return {
        kind: "send",
        payload: {
          data: [
            {
              event_name: name,
              event_time: Math.floor(event.eventTime.getTime() / 1000),
              event_id: event.eventId,
              action_source: "website",
              user_data,
              custom_data,
            },
          ],
        },
      };
    },
    async send(payload: Record<string, unknown>): Promise<void> {
      if (mode === "stub") {
        metaCapiSchema.parse(payload);
        console.log(JSON.stringify({ msg: "stub relay send", platform: "meta", payload }));
        return;
      }
      const datasetId = process.env.META_DATASET_ID;
      const token = process.env.META_ACCESS_TOKEN;
      if (!datasetId || !token) throw new Error("META_DATASET_ID / META_ACCESS_TOKEN required in live mode");
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${datasetId}/events?access_token=${token}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw new Error(`meta CAPI ${res.status}: ${await res.text()}`);
    },
  };
}
