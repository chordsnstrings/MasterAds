// Pinterest Conversions API relay (audit sprint W4). Same skip/consent
// semantics as the other relays; stub validates the recorded payload shape.
import { z } from "zod";
import type { ConversionEvent } from "@engine/db";
import { driverMode, type DriverMode } from "../env.js";
import type { ConversionRelay, RelayBuildResult } from "./types.js";

const PINTEREST_EVENT_NAMES: Record<string, string> = {
  ViewContent: "page_visit",
  AddToCart: "add_to_cart",
  Purchase: "checkout",
  Lead: "lead",
  CompleteRegistration: "signup",
};

// Recorded platform schema used by the stub driver to validate the exact
// outbound payload shape (Pinterest API v5 /events; verify per BLOCKED.md P5).
export const pinterestEventsSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            event_name: z.string(),
            action_source: z.literal("web"),
            event_time: z.number().int(),
            event_id: z.string(),
            user_data: z
              .object({
                em: z.array(z.string().regex(/^[a-f0-9]{64}$/)).optional(),
                ph: z.array(z.string().regex(/^[a-f0-9]{64}$/)).optional(),
                external_id: z.array(z.string().regex(/^[a-f0-9]{64}$/)).optional(),
                client_ip_address: z.string().optional(),
                client_user_agent: z.string().optional(),
                click_id: z.string().optional(),
              })
              .strict(),
            custom_data: z
              .object({
                value: z.string().optional(),
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

export function createPinterestRelay(opts?: { mode?: DriverMode }): ConversionRelay {
  const mode = opts?.mode ?? driverMode("PINTEREST_MODE");
  return {
    platform: "pinterest",
    mode,
    buildPayload(event: ConversionEvent): RelayBuildResult {
      const name = PINTEREST_EVENT_NAMES[event.eventName];
      if (!name) {
        return { kind: "skip", reason: `pinterest does not accept ${event.eventName} via Conversions API` };
      }
      if (!event.consentGranted) return { kind: "skip", reason: "consent not granted" };
      const { epik } = event.clickIds;
      const { email_sha256, phone_sha256 } = event.hashedIdentifiers;
      if (!epik && !email_sha256 && !phone_sha256) {
        return { kind: "skip", reason: "no attribution keys (epik/hashed identifiers)" };
      }
      const user_data: Record<string, unknown> = {};
      if (email_sha256) user_data.em = [email_sha256.toLowerCase()];
      if (phone_sha256) user_data.ph = [phone_sha256.toLowerCase()];
      if (event.hashedIdentifiers.external_id_sha256) {
        user_data.external_id = [event.hashedIdentifiers.external_id_sha256.toLowerCase()];
      }
      if (event.clientInfo.ip) user_data.client_ip_address = event.clientInfo.ip;
      if (event.clientInfo.user_agent) user_data.client_user_agent = event.clientInfo.user_agent;
      if (epik) user_data.click_id = epik;
      const custom_data: Record<string, unknown> = { content_ids: [event.contentId] };
      if (event.value !== null) custom_data.value = String(Number(event.value));
      if (event.currency !== null) custom_data.currency = event.currency;
      return {
        kind: "send",
        payload: {
          data: [
            {
              event_name: name,
              action_source: "web",
              event_time: Math.floor(event.eventTime.getTime() / 1000),
              event_id: event.eventId,
              user_data,
              custom_data,
            },
          ],
        },
      };
    },
    async send(payload: Record<string, unknown>): Promise<void> {
      if (mode === "stub") {
        pinterestEventsSchema.parse(payload);
        console.log(JSON.stringify({ msg: "stub relay send", platform: "pinterest", payload }));
        return;
      }
      const token = process.env.PINTEREST_ACCESS_TOKEN;
      const adAccountId = process.env.PINTEREST_AD_ACCOUNT_ID;
      if (!token || !adAccountId) {
        throw new Error("PINTEREST_ACCESS_TOKEN / PINTEREST_AD_ACCOUNT_ID required in live mode");
      }
      const res = await fetch(`https://api.pinterest.com/v5/ad_accounts/${adAccountId}/events`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`pinterest conversions ${res.status}: ${await res.text()}`);
    },
  };
}
