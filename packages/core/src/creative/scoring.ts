// Predictive pre-screening hook (SW §5.4): a scoring interface gating which
// variants launch vs are held. Stub: deterministic heuristic; a learned scorer
// can replace it behind the same interface.

export interface CreativeConcept {
  headline: string;
  body: string;
  visualDescriptor: string;
}

export interface PredictiveScorer {
  score(concept: CreativeConcept, context: { creativeAngle: string }): number;
}

export const LAUNCH_SCORE_THRESHOLD = 0.5;

/** Deterministic heuristic: rewards concrete, well-sized copy. */
export const heuristicScorer: PredictiveScorer = {
  score(concept, context): number {
    let score = 0.5;
    const headlineLen = concept.headline.length;
    if (headlineLen >= 12 && headlineLen <= 45) score += 0.15;
    else if (headlineLen < 6 || headlineLen > 70) score -= 0.2;
    const bodyLen = concept.body.length;
    if (bodyLen >= 30 && bodyLen <= 160) score += 0.15;
    if (/\d/.test(concept.body) || /\d/.test(concept.headline)) score += 0.1; // concreteness
    const exclamations = (concept.headline + concept.body).split("!").length - 1;
    score -= Math.min(0.3, exclamations * 0.1);
    if (concept.visualDescriptor.toLowerCase().includes(context.creativeAngle.replace(/_/g, " ")))
      score += 0.05;
    return Math.max(0, Math.min(1, Number(score.toFixed(4))));
  },
};
