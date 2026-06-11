import { describe, expect, it } from "vitest";
import type { ConversionEvent } from "@engine/db";
import {
  createGoogleRelay,
  createMetaRelay,
  createPinterestRelay,
  createSnapchatRelay,
  createTikTokRelay,
} from "../src/index.js";

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
    sccid: "sc-click-1",
    epik: "pin-click-1",
  },
  hashedIdentifiers: { email_sha256: "a".repeat(64), phone_sha256: "b".repeat(64) },
  eventId: "order-1",
  sourceSite: "shop-a",
  consentGranted: true,
  clientInfo: {},
  consentSignals: {},
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

  it("snapchat Conversions API payload is byte-correct (W4)", () => {
    const built = createSnapchatRelay({ mode: "stub" }).buildPayload(fixtureEvent);
    expect(built.kind).toBe("send");
    if (built.kind !== "send") return;
    expect(JSON.stringify(built.payload)).toMatchInlineSnapshot(`"{"pixel_id":"stub-snap-pixel","event_type":"PURCHASE","event_conversion_type":"WEB","timestamp":1780315200000,"client_dedup_id":"order-1","hashed_email":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","hashed_phone_number":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","click_id":"sc-click-1","price":250,"currency":"AED","item_ids":["prod_x"]}"`);
  });

  it("pinterest Conversions API payload is byte-correct (W4)", () => {
    const built = createPinterestRelay({ mode: "stub" }).buildPayload(fixtureEvent);
    expect(built.kind).toBe("send");
    if (built.kind !== "send") return;
    expect(JSON.stringify(built.payload)).toMatchInlineSnapshot(`"{"data":[{"event_name":"checkout","action_source":"web","event_time":1780315200,"event_id":"order-1","user_data":{"em":["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],"ph":["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],"click_id":"pin-click-1"},"custom_data":{"content_ids":["prod_x"],"value":"250","currency":"AED"}}]}"`);
  });

  it("snapchat/pinterest stub sends validate against the recorded schemas", async () => {
    for (const relay of [createSnapchatRelay({ mode: "stub" }), createPinterestRelay({ mode: "stub" })]) {
      const built = relay.buildPayload(fixtureEvent);
      if (built.kind !== "send") throw new Error("expected send");
      await expect(relay.send(built.payload)).resolves.toBeUndefined();
      await expect(relay.send({ wrong: true })).rejects.toThrow();
    }
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
      createSnapchatRelay({ mode: "stub" }),
      createPinterestRelay({ mode: "stub" }),
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

  it("rich identifiers + consent v2 reach the platform payloads (W2)", () => {
    const rich: ConversionEvent = {
      ...fixtureEvent,
      hashedIdentifiers: {
        email_sha256: "a".repeat(64),
        phone_sha256: "b".repeat(64),
        first_name_sha256: "c".repeat(64),
        last_name_sha256: "d".repeat(64),
        city_sha256: "e".repeat(64),
        zip_sha256: "f".repeat(64),
        country_sha256: "0".repeat(64),
        external_id_sha256: "1".repeat(64),
      },
      clientInfo: { ip: "203.0.113.7", user_agent: "Mozilla/5.0 test" },
      consentSignals: { ad_user_data: true, ad_personalization: false },
    };
    const meta = createMetaRelay({ mode: "stub" }).buildPayload(rich);
    if (meta.kind !== "send") throw new Error("expected send");
    const ud = (meta.payload.data as { user_data: Record<string, unknown> }[])[0]!.user_data;
    expect(ud.fn).toEqual(["c".repeat(64)]);
    expect(ud.external_id).toEqual(["1".repeat(64)]);
    expect(ud.client_ip_address).toBe("203.0.113.7");

    const g = createGoogleRelay({ mode: "stub" }).buildPayload(rich);
    if (g.kind !== "send") throw new Error("expected send");
    const conv = (g.payload.conversions as Record<string, unknown>[])[0]!;
    expect(conv.consent).toEqual({ ad_user_data: "GRANTED", ad_personalization: "DENIED" });
    expect(
      (conv.user_identifiers as Record<string, unknown>[]).some((i) => "address_info" in i),
    ).toBe(true);

    const tt = createTikTokRelay({ mode: "stub" }).buildPayload(rich);
    if (tt.kind !== "send") throw new Error("expected send");
    const user = (tt.payload.data as { user: Record<string, unknown> }[])[0]!.user;
    expect(user.external_id).toBe("1".repeat(64));
    expect(user.ip).toBe("203.0.113.7");
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
