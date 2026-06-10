import { describe, expect, it } from "vitest";
import {
  CANONICAL_EVENTS,
  conversionPayloadSchema,
  dedupKey,
  normalizeEventName,
  reconciliationKey,
} from "../src/index.js";

const base = {
  event_time: 1765000000,
  content_id: "prod_1",
  event_id: "evt-1",
  source_site: "shop-a",
};

function payloadFor(eventName: string): Record<string, unknown> {
  const p: Record<string, unknown> = { ...base, event_name: eventName };
  if (eventName === "Purchase") {
    p.value = 100;
    p.currency = "aed";
  }
  return p;
}

describe("conversion contract (GATE G2)", () => {
  it("accepts a valid payload for every canonical event type", () => {
    for (const name of CANONICAL_EVENTS) {
      const r = conversionPayloadSchema.safeParse(payloadFor(name));
      expect(r.success, `${name}: ${JSON.stringify(!r.success && r.error.issues)}`).toBe(true);
    }
  });

  it("normalizes platform aliases to the canonical taxonomy", () => {
    expect(normalizeEventName("CompletePayment")).toBe("Purchase");
    expect(normalizeEventName("SubmitForm")).toBe("Lead");
    expect(normalizeEventName("submit_lead_form")).toBe("Lead");
    expect(normalizeEventName("begin_checkout")).toBe("InitiateCheckout");
    expect(normalizeEventName("sign_up")).toBe("CompleteRegistration");
    expect(normalizeEventName("add_to_cart")).toBe("AddToCart");
    expect(normalizeEventName("nonsense")).toBeUndefined();
  });

  it("rejects unknown event names with a precise error", () => {
    const r = conversionPayloadSchema.safeParse({ ...base, event_name: "BoughtStuff" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toContain('unknown event_name "BoughtStuff"');
    }
  });

  it("requires value+currency on monetary events", () => {
    const noValue = conversionPayloadSchema.safeParse({ ...base, event_name: "Purchase" });
    expect(noValue.success).toBe(false);
    const noCurrency = conversionPayloadSchema.safeParse({
      ...base,
      event_name: "Purchase",
      value: 50,
    });
    expect(noCurrency.success).toBe(false);
    if (!noCurrency.success) {
      expect(noCurrency.error.issues.map((i) => i.path.join("."))).toContain("currency");
    }
  });

  it("rejects millisecond event_time", () => {
    const r = conversionPayloadSchema.safeParse({
      ...payloadFor("ViewContent"),
      event_time: Date.now(),
    });
    expect(r.success).toBe(false);
  });

  it("rejects malformed hashed identifiers and unknown click id keys", () => {
    const badHash = conversionPayloadSchema.safeParse({
      ...payloadFor("Lead"),
      hashed_identifiers: { email_sha256: "not-a-hash" },
    });
    expect(badHash.success).toBe(false);
    const badClickId = conversionPayloadSchema.safeParse({
      ...payloadFor("Lead"),
      click_ids: { msclkid: "x" },
    });
    expect(badClickId.success).toBe(false);
  });

  it("dedup and reconciliation keys", () => {
    expect(dedupKey({ source_site: "a", event_id: "1" })).toBe("a:1");
    const email = "b".repeat(64);
    expect(
      reconciliationKey({
        event_name: "CompletePayment",
        event_id: "x1",
        hashed_identifiers: { email_sha256: email },
      }),
    ).toBe(`Purchase:x1:${email}`);
  });
});
