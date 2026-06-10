// GATE G12: microcopy snapshot tests — FLOW §12 strings used verbatim.
import { describe, expect, it } from "vitest";
import { STRINGS } from "../src/strings";

const C = STRINGS.creation;

describe("FLOW §12 microcopy (verbatim, binding)", () => {
  it("matches the specified strings exactly", () => {
    expect(C.addTitle).toBe("Add something to advertise");
    expect(C.inputPlaceholder).toBe("Paste a link · or type what you sell…");
    expect(`${C.wayLink} · ${C.wayDescribe} · ${C.wayList}`).toBe(
      "Paste a link · Describe it · Add a list",
    );
    expect(C.goalDefault).toBe("We'll choose the best");
    expect(C.budgetDefault).toBe("We'll suggest");
    expect(C.continue).toBe("Continue");
    expect(C.reading).toBe("Reading that…");
    expect(C.linkFailed).toBe("We couldn't open that link. Tell us what you sell instead.");
    expect(C.disambiguation).toBe(
      "Is this closer to selling a product, or offering a service?",
    );
    expect(C.reviewTitle).toBe("Here's the plan");
    expect(C.reassurance).toBe("We'll start small and put more money behind whatever works.");
    expect(C.lowBudgetNote).toBe(
      "Below about AED 150 a day it's harder for us to learn what works, so results may be slower.",
    );
    expect(C.creativeHelp(3)).toBe("We made 3. Keep all, or pick your favorites.");
    expect(C.makeNew).toBe("Make new ones");
    expect(C.preLaunchReassurance).toBe("You can pause or change anything later.");
    expect(C.launch).toBe("Launch");
    expect(C.destinationQuestion).toBe("When someone taps your ad, where should they go?");
    expect(C.noAccount).toBe("First, choose where to advertise.");
    expect(C.restrictedNotice).toBe(
      "Ads for financial services need a quick check before they go live. We'll handle it and let you know when they're approved — usually within a day.",
    );
    expect(C.submitForReview).toBe("Submit for review");
    expect(C.confirmTitle).toBe("You're live.");
    expect(C.confirmBody).toBe(
      "We're showing your ads and learning what works. You don't need to do anything.",
    );
    expect(C.spendReassurance("AED", 500)).toBe("We'll never spend more than AED 500 a day.");
    expect(C.seeHow).toBe("See how it's doing");
  });

  it("the plan sentence reads as one plain sentence with the same values as the lines below", () => {
    expect(C.planSentence("sofa", "buy it", "Instagram, Facebook · TikTok", "AED", 500)).toBe(
      "We'll advertise your sofa to people likely to buy it, on Instagram, Facebook · TikTok, for about AED 500 a day. We'll start small and put more money behind whatever works.",
    );
  });
});
