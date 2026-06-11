// Snapchat Conversions API relay (audit sprint W4). Same skip/consent
// semantics as the other relays; stub validates the recorded payload shape.
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ConversionEvent } from "@engine/db";
import { driverMode, type DriverMode } from "../env.js";
import type { ConversionRelay, RelayBuildResult } from "./types.js";

const SNAP_EVENT_TYPES: Record<string, string> = {
  ViewContent: "VIEW_CONTENT",
  AddToCart: "ADD_CART",
  InitiateCheckout: "START_CHECKOUT",
  Purchase: "PURCHASE",
  Lead: "SIGN_UP",
  CompleteRegistration: "SIGN_UP",
};

// Recorded platform schema used by the stub driver to validate the exact
// outbound payload shape (Snap CAPI; verify against live API per BLOCKED.md P5).
export const snapchatConversionSchema = z
  .object({
    pixel_id: z.string(),
    event_type: z.string(),
    event_conversion_type: z.literal("WEB"),
    timestamp: z.number().int(),
    client_dedup_id: z.string(),
    hashed_email: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    hashed_phone_number: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    hashed_ip_address: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    user_agent: z.string().optional(),
    click_id: z.string().optional(),
    price: z.number().optional(),
    currency: z.string().length(3).optional(),
    item_ids: z.array(z.string()),
  })
  .strict();

export function createSnapchatRelay(opts?: { mode?: DriverMode }): ConversionRelay {
  const mode = opts?.mode ?? driverMode("SNAPCHAT_MODE");
  return {
    platform: "snapchat",
    mode,
    buildPayload(event: ConversionEvent): RelayBuildResult {
      const eventType = SNAP_EVENT_TYPES[event.eventName];
      if (!eventType) {
        return { kind: "skip", reason: `snapchat does not accept ${event.eventName} via Conversions API` };
      }
      if (!event.consentGranted) return { kind: "skip", reason: "consent not granted" };
      const { sccid } = event.clickIds;
      const { email_sha256, phone_sha256 } = event.hashedIdentifiers;
      if (!sccid && !email_sha256 && !phone_sha256) {
        return { kind: "skip", reason: "no attribution keys (sccid/hashed identifiers)" };
      }
      const payload: Record<string, unknown> = {
        pixel_id: process.env.SNAPCHAT_PIXEL_ID ?? "stub-snap-pixel",
        event_type: eventType,
        event_conversion_type: "WEB",
        timestamp: event.eventTime.getTime(),
        client_dedup_id: event.eventId,
      };
      if (email_sha256) payload.hashed_email = email_sha256.toLowerCase();
      if (phone_sha256) payload.hashed_phone_number = phone_sha256.toLowerCase();
      if (event.clientInfo.ip) {
        payload.hashed_ip_address = createHash("sha256").update(event.clientInfo.ip).digest("hex");
      }
      if (event.clientInfo.user_agent) payload.user_agent = event.clientInfo.user_agent;
      if (sccid) payload.click_id = sccid;
      if (event.value !== null) payload.price = Number(event.value);
      if (event.currency !== null) payload.currency = event.currency;
      payload.item_ids = [event.contentId];
      return { kind: "send", payload };
    },
    async send(payload: Record<string, unknown>): Promise<void> {
      if (mode === "stub") {
        snapchatConversionSchema.parse(payload);
        console.log(JSON.stringify({ msg: "stub relay send", platform: "snapchat", payload }));
        return;
      }
      const token = process.env.SNAPCHAT_ACCESS_TOKEN;
      if (!token) throw new Error("SNAPCHAT_ACCESS_TOKEN required in live mode");
      const res = await fetch("https://tr.snapchat.com/v2/conversion", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`snapchat conversions ${res.status}: ${await res.text()}`);
    },
  };
}
