// @vitest-environment jsdom
// GATE G11 component tests: chips for the exact ordered lifecycle set, funnel
// bars, activity why expansion, money/number rendering in monospace.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ActivityItem,
  FunnelBars,
  KpiTile,
  Money,
  StatusChip,
  relativeTime,
} from "../src/components";
import { STRINGS } from "../src/strings";

afterEach(cleanup);

describe("StatusChip (UX §7 fixed ordered set)", () => {
  const LIFECYCLE = ["draft", "launching", "learning", "autonomous", "needs_attention", "paused"];
  it("renders every lifecycle state with its label", () => {
    for (const status of LIFECYCLE) {
      render(<StatusChip status={status} />);
      expect(screen.getByText(STRINGS.status[status]!)).toBeTruthy();
      cleanup();
    }
  });
});

describe("FunnelBars", () => {
  it("renders stage labels and counts", () => {
    render(
      <FunnelBars
        funnel={[
          { stage: "ViewContent", count: 18200 },
          { stage: "AddToCart", count: 2140 },
          { stage: "Purchase", count: 312 },
        ]}
      />,
    );
    expect(screen.getByText("Views")).toBeTruthy();
    expect(screen.getByText("Add to cart")).toBeTruthy();
    expect(screen.getByText("18,200")).toBeTruthy();
    expect(screen.getByText("312")).toBeTruthy();
  });
});

describe("ActivityItem", () => {
  it("expands the why with evidence and outcomes", () => {
    render(
      <ActivityItem
        entry={{
          id: "d1",
          at: new Date().toISOString(),
          actionType: "budget_change",
          kind: "budget",
          text: "Moved budget toward what's converting.",
          evidence: [{ metric: "net_return", window: "7d", result: "3.4×" }],
          predictedOutcome: "+15% sales",
          actualOutcome: "+12% sales",
          executed: true,
          guardrailStatus: "passed",
          productId: null,
        }}
      />,
    );
    expect(screen.getByText("Moved budget toward what's converting.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: STRINGS.product.why }));
    expect(screen.getByText("3.4×")).toBeTruthy();
    expect(screen.getByText("+15% sales")).toBeTruthy();
    expect(screen.getByText("+12% sales")).toBeTruthy();
  });
});

describe("numerics render in the monospace face (UX §8.2)", () => {
  it("Money uses font-mono", () => {
    const { container } = render(<Money value={12400} currency="AED" />);
    expect(container.querySelector(".font-mono")?.textContent).toContain("AED 12.4k");
  });
  it("KpiTile shows label and value", () => {
    render(<KpiTile label="Spend · 7 days" value={<Money value={500} />} />);
    expect(screen.getByText("Spend · 7 days")).toBeTruthy();
  });
});

describe("relativeTime", () => {
  it("formats minutes/hours/days", () => {
    expect(relativeTime(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5m ago");
    expect(relativeTime(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe("3h ago");
    expect(relativeTime(new Date(Date.now() - 2 * 86_400_000).toISOString())).toBe("2d ago");
  });
});
