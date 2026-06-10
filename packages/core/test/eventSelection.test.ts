// GATE G5: event-selection unit tests — high-volume (terminal), thin-volume
// (fallback), and consolidation cases. Pure function, exhaustively tested.
import { describe, expect, it } from "vitest";
import { selectOptimizationEvent } from "../src/classify/eventSelection.js";

describe("volume-aware optimization-event selection (SW §5.3, Appendix C)", () => {
  it("high-volume product optimizes on the terminal event", () => {
    const s = selectOptimizationEvent({
      terminalEvent: "Purchase",
      expectedWeeklyTerminalVolume: 90,
    });
    expect(s.optimizationEvent).toBe("Purchase");
    expect(s.consolidate).toBe(false);
    expect(s.expectedWeeklyVolume).toBe(90);
  });

  it("exactly at threshold stays on terminal", () => {
    const s = selectOptimizationEvent({
      terminalEvent: "Purchase",
      expectedWeeklyTerminalVolume: 50,
    });
    expect(s.optimizationEvent).toBe("Purchase");
  });

  it("thin volume falls back upstream to the deepest clearing event", () => {
    // 20/week purchases → IC ~60 clears 50.
    const s = selectOptimizationEvent({
      terminalEvent: "Purchase",
      expectedWeeklyTerminalVolume: 20,
    });
    expect(s.optimizationEvent).toBe("InitiateCheckout");
    expect(s.consolidate).toBe(false);
    expect(s.rationale).toContain("deepest event");
  });

  it("thinner volume falls further back (AddToCart, then ViewContent)", () => {
    expect(
      selectOptimizationEvent({ terminalEvent: "Purchase", expectedWeeklyTerminalVolume: 8 })
        .optimizationEvent,
    ).toBe("AddToCart");
    expect(
      selectOptimizationEvent({ terminalEvent: "Purchase", expectedWeeklyTerminalVolume: 1 })
        .optimizationEvent,
    ).toBe("ViewContent");
  });

  it("consolidates when even the shallowest event misses the threshold", () => {
    const s = selectOptimizationEvent({
      terminalEvent: "Purchase",
      expectedWeeklyTerminalVolume: 0.5,
    });
    expect(s.optimizationEvent).toBe("ViewContent");
    expect(s.consolidate).toBe(true);
    expect(s.rationale).toContain("consolidate");
  });

  it("lead-gen chain falls back Lead → ViewContent", () => {
    expect(
      selectOptimizationEvent({ terminalEvent: "Lead", expectedWeeklyTerminalVolume: 60 })
        .optimizationEvent,
    ).toBe("Lead");
    const thin = selectOptimizationEvent({ terminalEvent: "Lead", expectedWeeklyTerminalVolume: 5 });
    expect(thin.optimizationEvent).toBe("ViewContent");
    expect(thin.consolidate).toBe(false);
  });

  it("respects the funnel stages actually present", () => {
    const s = selectOptimizationEvent({
      terminalEvent: "Purchase",
      expectedWeeklyTerminalVolume: 20,
      funnelStages: ["ViewContent", "Purchase"], // no checkout events tracked
    });
    expect(s.optimizationEvent).toBe("ViewContent");
  });

  it("install chain has no upstream fallback → consolidation", () => {
    const s = selectOptimizationEvent({ terminalEvent: "Install", expectedWeeklyTerminalVolume: 10 });
    expect(s.optimizationEvent).toBe("Install");
    expect(s.consolidate).toBe(true);
  });

  it("custom threshold is honored", () => {
    const s = selectOptimizationEvent({
      terminalEvent: "Purchase",
      expectedWeeklyTerminalVolume: 20,
      threshold: 15,
    });
    expect(s.optimizationEvent).toBe("Purchase");
  });
});
