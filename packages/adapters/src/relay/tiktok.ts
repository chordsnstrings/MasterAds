// TikTok Events API relay (SW §7.2, Appendix A/B).
import { z } from "zod";
import type { ConversionEvent } from "@engine/db";
import { driverMode, type DriverMode } from "../env.js";
import type { ConversionRelay, RelayBuildResult } from "./types.js";

const TIKTOK_EVENT_NAMES: Record<string, string> = {
  ViewContent: "ViewContent",
  AddToCart: "AddToCart",
  InitiateCheckout: "InitiateCheckout",
  Purchase: "CompletePayment",
  Lead: "SubmitForm",
  CompleteRegistration: "CompleteRegistration",
};

export const tiktokEventsSchema = z
  .object({
    event_source: z.literal("web"),
    event_source_id: z.string(),
    data: z
      .array(
        z
          .object({
            event: z.string(),
            event_time: z.number().int(),
            event_id: z.string(),
            user: z
              .object({
                email: z.string().regex(/^[a-f0-9]{64}$/).optional(),
                phone: z.string().regex(/^[a-f0-9]{64}$/).optional(),
                external_id: z.string().regex(/^[a-f0-9]{64}$/).optional(),
                ip: z.string().optional(),
                user_agent: z.string().optional(),
                ttclid: z.string().optional(),
              })
              .strict(),
            properties: z
              .object({
                value: z.number().optional(),
                currency: z.string().length(3).optional(),
                content_id: z.string(),
              })
              .strict(),
          })
          .strict(),
      )
      .length(1),
  })
  .strict();

export function createTikTokRelay(opts?: { mode?: DriverMode }): ConversionRelay {
  const mode = opts?.mode ?? driverMode("TIKTOK_MODE");
  return {
    platform: "tiktok",
    mode,
    buildPayload(event: ConversionEvent): RelayBuildResult {
      const name = TIKTOK_EVENT_NAMES[event.eventName];
      if (!name) return { kind: "skip", reason: `tiktok does not accept ${event.eventName} via Events API` };
      if (!event.consentGranted) return { kind: "skip", reason: "consent not granted" };
      const { ttclid } = event.clickIds;
      const { email_sha256, phone_sha256 } = event.hashedIdentifiers;
      if (!ttclid && !email_sha256 && !phone_sha256) {
        return { kind: "skip", reason: "no attribution keys (ttclid/hashed identifiers)" };
      }
      const user: Record<string, unknown> = {};
      if (email_sha256) user.email = email_sha256.toLowerCase();
      if (phone_sha256) user.phone = phone_sha256.toLowerCase();
      if (event.hashedIdentifiers.external_id_sha256) {
        user.external_id = event.hashedIdentifiers.external_id_sha256.toLowerCase();
      }
      if (event.clientInfo.ip) user.ip = event.clientInfo.ip;
      if (event.clientInfo.user_agent) user.user_agent = event.clientInfo.user_agent;
      if (ttclid) user.ttclid = ttclid;
      const properties: Record<string, unknown> = { content_id: event.contentId };
      if (event.value !== null) properties.value = Number(event.value);
      if (event.currency !== null) properties.currency = event.currency;
      return {
        kind: "send",
        payload: {
          event_source: "web",
          event_source_id: process.env.TIKTOK_PIXEL_CODE ?? "stub-pixel-code",
          data: [
            {
              event: name,
              event_time: Math.floor(event.eventTime.getTime() / 1000),
              event_id: event.eventId,
              user,
              properties,
            },
          ],
        },
      };
    },
    async send(payload: Record<string, unknown>): Promise<void> {
      if (mode === "stub") {
        tiktokEventsSchema.parse(payload);
        console.log(JSON.stringify({ msg: "stub relay send", platform: "tiktok", payload }));
        return;
      }
      const token = process.env.TIKTOK_ACCESS_TOKEN;
      if (!token) throw new Error("TIKTOK_ACCESS_TOKEN required in live mode");
      const res = await fetch("https://business-api.tiktok.com/open_api/v1.3/event/track/", {
        method: "POST",
        headers: { "content-type": "application/json", "Access-Token": token },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`tiktok events ${res.status}: ${await res.text()}`);
    },
  };
}
