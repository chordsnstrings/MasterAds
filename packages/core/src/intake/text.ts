// Offer-text intake (the lifeline path, FLOW §3): free text stored raw for
// classification (G5); a readable title derived for display.
import type { IntakeResult } from "./types.js";

export function intakeFromText(text: string): IntakeResult {
  const trimmed = text.trim();
  if (trimmed.length < 3) {
    return {
      kind: "unreadable",
      reason: "description_too_short",
      suggestion: "Tell us a little more about what you sell, in your own words.",
    };
  }
  const firstSentence = trimmed.split(/[.\n!?]/)[0] ?? trimmed;
  const title = firstSentence.length > 80 ? `${firstSentence.slice(0, 77)}…` : firstSentence;
  return {
    kind: "product",
    product: {
      mode: "offer",
      title,
      description: trimmed,
      images: [],
      availability: "in_stock",
      sourceRef: "text",
      rawInput: trimmed,
    },
  };
}
