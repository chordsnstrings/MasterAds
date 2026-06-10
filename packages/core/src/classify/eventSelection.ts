// Volume-aware optimization-event selection (SW §5.3, Appendix C).
// The optimizer needs ~50 optimization-event conversions/week to exit learning;
// optimize on the deepest event clearing that threshold, fall back upstream,
// consolidate thin products. Pure function — among the highest-leverage logic
// in the system.

export const LEARNING_THRESHOLD_PER_WEEK = 50;

/** Upstream fallback chain per terminal event (deepest first). */
const FALLBACK_CHAINS: Record<string, string[]> = {
  Purchase: ["Purchase", "InitiateCheckout", "AddToCart", "ViewContent"],
  Lead: ["Lead", "ViewContent"],
  CompleteRegistration: ["CompleteRegistration", "ViewContent"],
  Install: ["Install"],
};

/** Typical volume multiplier vs the terminal event, by funnel stage. */
const STAGE_VOLUME_MULTIPLIERS: Record<string, Record<string, number>> = {
  Purchase: { Purchase: 1, InitiateCheckout: 3, AddToCart: 7, ViewContent: 60 },
  Lead: { Lead: 1, ViewContent: 40 },
  CompleteRegistration: { CompleteRegistration: 1, ViewContent: 40 },
  Install: { Install: 1 },
};

export interface EventSelectionInput {
  terminalEvent: string;
  /** Expected terminal conversions per week for this product. */
  expectedWeeklyTerminalVolume: number;
  /** Restrict the chain to stages actually present in the funnel. */
  funnelStages?: string[];
  threshold?: number;
}

export interface EventSelection {
  optimizationEvent: string;
  expectedWeeklyVolume: number;
  /** True when even the shallowest event misses the threshold: pool signal
   * by consolidating this product into a shared slice. */
  consolidate: boolean;
  rationale: string;
}

export function selectOptimizationEvent(input: EventSelectionInput): EventSelection {
  const threshold = input.threshold ?? LEARNING_THRESHOLD_PER_WEEK;
  const chain = FALLBACK_CHAINS[input.terminalEvent] ?? [input.terminalEvent];
  const multipliers = STAGE_VOLUME_MULTIPLIERS[input.terminalEvent] ?? { [input.terminalEvent]: 1 };
  const stages = input.funnelStages
    ? chain.filter((s) => input.funnelStages!.includes(s))
    : chain;
  const effective = stages.length > 0 ? stages : chain;

  for (const stage of effective) {
    const expected = input.expectedWeeklyTerminalVolume * (multipliers[stage] ?? 1);
    if (expected >= threshold) {
      return {
        optimizationEvent: stage,
        expectedWeeklyVolume: expected,
        consolidate: false,
        rationale:
          stage === input.terminalEvent
            ? `terminal volume ~${Math.round(expected)}/week clears the ~${threshold}/week learning threshold`
            : `terminal volume too thin; ${stage} (~${Math.round(expected)}/week) is the deepest event clearing ~${threshold}/week`,
      };
    }
  }

  const shallowest = effective[effective.length - 1] ?? input.terminalEvent;
  const expected = input.expectedWeeklyTerminalVolume * (multipliers[shallowest] ?? 1);
  return {
    optimizationEvent: shallowest,
    expectedWeeklyVolume: expected,
    consolidate: true,
    rationale: `even ${shallowest} (~${Math.round(expected)}/week) misses ~${threshold}/week; consolidate into a shared slice to pool signal`,
  };
}
