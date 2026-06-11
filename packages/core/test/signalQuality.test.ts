// W2.2: EMQ-style signal scoring — identifier richness drives the score.
import { describe, expect, it } from "vitest";
import type { ConversionEvent } from "@engine/db";
import { computeSignalQuality, scoreEventSignal } from "../src/signalQuality.js";

function event(overrides: Partial<ConversionEvent>): ConversionEvent {
  return {
    id: "evt_1",
    eventName: "Purchase",
    eventTime: new Date(),
    value: "100.0000",
    currency: "AED",
    contentId: "p1",
    clickIds: {},
    hashedIdentifiers: {},
    eventId: "e1",
    sourceSite: "shop",
    consentGranted: true,
    clientInfo: {},
    consentSignals: {},
    relayedTo: [],
    dedupKey: "d",
    reconciliationKey: "r",
    canonical: true,
    receivedAt: new Date(),
    ...overrides,
  } as ConversionEvent;
}

describe("scoreEventSignal", () => {
  it("bare events score low; fully-identified events score 10", () => {
    expect(scoreEventSignal(event({})).score).toBe(0);
    const rich = event({
      clickIds: { fbclid: "x" },
      hashedIdentifiers: {
        email_sha256: "a".repeat(64),
        phone_sha256: "b".repeat(64),
        first_name_sha256: "c".repeat(64),
        last_name_sha256: "d".repeat(64),
        city_sha256: "e".repeat(64),
        external_id_sha256: "f".repeat(64),
      },
      clientInfo: { ip: "203.0.113.1", user_agent: "UA" },
    });
    expect(scoreEventSignal(rich).score).toBe(10);
    expect(scoreEventSignal(rich).missing).toEqual([]);
  });

  it("email + click id alone reach mid-strength", () => {
    const b = scoreEventSignal(
      event({ clickIds: { gclid: "g" }, hashedIdentifiers: { email_sha256: "a".repeat(64) } }),
    );
    expect(b.score).toBe(5);
    expect(b.has).toContain("email");
    expect(b.has).toContain("click_id");
    expect(b.missing).toContain("phone");
  });
});

describe("computeSignalQuality", () => {
  it("averages per site and surfaces the most common missing keys", () => {
    const events = [
      event({ sourceSite: "a", clickIds: { fbclid: "1" }, hashedIdentifiers: { email_sha256: "a".repeat(64) } }),
      event({ sourceSite: "a", clickIds: {}, hashedIdentifiers: {} }),
      event({ sourceSite: "b", canonical: false }), // non-canonical excluded
    ];
    const rows = computeSignalQuality(events);
    expect(rows.length).toBe(1);
    expect(rows[0]?.sourceSite).toBe("a");
    expect(rows[0]?.avgScore).toBe(2.5); // (5 + 0) / 2
    expect(rows[0]?.eventsTotal).toBe(2);
    expect(rows[0]?.topMissing.length).toBeGreaterThan(0);
  });
});
