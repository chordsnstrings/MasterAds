import { describe, expect, it } from "vitest";
import type { ConversionEvent } from "@engine/db";
import { createGoogleRelay, createMetaRelay, createTikTokRelay } from "../src/index.js";

const fixtureEvent: ConversionEvent = {
  id: "evt_fixture_1",
  eventName: "Purchase",
  eventTime: new Date("2026-06-01T12:00:00Z"),
  value: "250.0000",
  currency: "AED",
  contentId: "prod_x",
  clickIds: {
    fbclid: "fb-click-1",
    fbp: "fb.1.1700000000.111",
    gclid: "g-click-1",
    ttclid: "tt-click-1",
  },
  hashedIdentifiers: { email_sha256: "a".repeat(64), phone_sha256: "b".repeat(64) },
  eventId: "order-1",
  sourceSite: "shop-a",
  consentGranted: true,
  relayedTo: [],
  dedupKey: "shop-a:order-1",
  reconciliationKey: `Purchase:order-1:${"a".repeat(64)}`,
  canonical: true,
  receivedAt: new Date("2026-06-01T12:00:05Z"),
};

describe("relay payload mapping (GATE G3 snapshots)", () => {
  it("meta CAPI payload is byte-correct", () => {
    const built = createMetaRelay({ mode: "stub" }).buildPayload(fixtureEvent);
    expect(built.kind).toBe("send");
    if (built.kind !== "send") return;
    expect(JSON.stringify(built.payload)).toMatchInlineSnapshot(
      `"{"data":[{"event_name":"Purchase","event_time":1780315200,"event_id":"order-1","action_source":"website","user_data":{"em":["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],"ph":["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],"fbc":"fb.1.1780315200000.fb-click-1","fbp":"fb.1.1700000000.111"},"custom_data":{"content_ids":["prod_x"],"value":250,"currency":"AED"}}]}"`,
    );
  });

  it("tiktok Events API payload is byte-correct", () => {
    const built = createTikTokRelay({ mode: "stub" }).buildPayload(fixtureEvent);
    expect(built.kind).toBe("send");
    if (built.kind !== "send") return;
    expect(JSON.stringify(built.payload)).toMatchInlineSnapshot(
      `"{"event_source":"web","event_source_id":"stub-pixel-code","data":[{"event":"CompletePayment","event_time":1780315200,"event_id":"order-1","user":{"email":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","phone":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","ttclid":"tt-click-1"},"properties":{"content_id":"prod_x","value":250,"currency":"AED"}}]}"`,
    );
  });

  it("google enhanced conversions payload is byte-correct", () => {
    const built = createGoogleRelay({ mode: "stub" }).buildPayload(fixtureEvent);
    expect(built.kind).toBe("send");
    if (built.kind !== "send") return;
    expect(JSON.stringify(built.payload)).toMatchInlineSnapshot(
      `"{"conversions":[{"conversion_action":"purchase","conversion_date_time":"2026-06-01 12:00:00+00:00","order_id":"order-1","cart_data":{"items":[{"product_id":"prod_x"}]},"gclid":"g-click-1","conversion_value":250,"currency_code":"AED","user_identifiers":[{"hashed_email":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},{"hashed_phone_number":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]}],"partial_failure":true}"`,
    );
  });

  it("stub send validates against the recorded platform schema", async () => {
    const meta = createMetaRelay({ mode: "stub" });
    const built = meta.buildPayload(fixtureEvent);
    if (built.kind !== "send") throw new Error("expected send");
    await expect(meta.send(built.payload)).resolves.toBeUndefined();
    await expect(meta.send({ data: [{ wrong: true }] })).rejects.toThrow();
  });

  it("skips with a reason when attribution keys are absent", () => {
    const bare: ConversionEvent = {
      ...fixtureEvent,
      clickIds: {},
      hashedIdentifiers: {},
    };
    for (const relay of [
      createMetaRelay({ mode: "stub" }),
      createGoogleRelay({ mode: "stub" }),
      createTikTokRelay({ mode: "stub" }),
    ]) {
      const built = relay.buildPayload(bare);
      expect(built.kind).toBe("skip");
      if (built.kind === "skip") expect(built.reason).toContain("no attribution keys");
    }
  });

  it("skips when consent is not granted (SW §8.8)", () => {
    const noConsent = { ...fixtureEvent, consentGranted: false };
    const built = createMetaRelay({ mode: "stub" }).buildPayload(noConsent);
    expect(built.kind).toBe("skip");
  });

  it("event name mapping per platform (Appendix A)", () => {
    const lead = { ...fixtureEvent, eventName: "Lead" };
    const tt = createTikTokRelay({ mode: "stub" }).buildPayload(lead);
    if (tt.kind !== "send") throw new Error("expected send");
    expect((tt.payload.data as { event: string }[])[0]?.event).toBe("SubmitForm");
    const g = createGoogleRelay({ mode: "stub" }).buildPayload(lead);
    if (g.kind !== "send") throw new Error("expected send");
    expect((g.payload.conversions as { conversion_action: string }[])[0]?.conversion_action).toBe(
      "submit_lead_form",
    );
  });
});
