/**
 * Scoring parameters. Transcribed from docs/04-TRUST_SCORING.md.
 *
 * Every parameter is a named constant here, surfaced on /verify, and changeable
 * without touching logic. Judges may reasonably disagree with a threshold; they
 * should be able to see exactly what it is.
 */

export const SCORING_DEFAULTS = {
  minReviewerAgeSeconds: 7 * 24 * 3600,
  lambda: 0.05,
  clusterWeights: { reciprocity: 0.45, temporal: 0.35, funding: 0.2 },
  positiveThreshold: 0.5,
  recomputeIntervalMinutes: 15,
} as const;

export type ScoringConfig = {
  minReviewerAgeSeconds: number;
  lambda: number;
  clusterWeights: { reciprocity: number; temporal: number; funding: number };
  positiveThreshold: number;
  recomputeIntervalMinutes: number;
};

export const defaultScoringConfig = (): ScoringConfig => ({
  minReviewerAgeSeconds: SCORING_DEFAULTS.minReviewerAgeSeconds,
  lambda: SCORING_DEFAULTS.lambda,
  clusterWeights: { ...SCORING_DEFAULTS.clusterWeights },
  positiveThreshold: SCORING_DEFAULTS.positiveThreshold,
  recomputeIntervalMinutes: SCORING_DEFAULTS.recomputeIntervalMinutes,
});

/**
 * Human-readable descriptions of each parameter, rendered on /verify so the
 * page cannot drift from the values actually in use.
 */
export const PARAMETER_DESCRIPTIONS: Record<string, string> = {
  minReviewerAgeSeconds:
    "How long a reviewer address must have existed on-chain before its review counts. Addresses created to review are excluded.",
  lambda:
    "Saturation rate of the demand index. Early verified history moves the ranking a lot; past roughly 60 accumulated weight, more history barely helps.",
  positiveThreshold:
    "The registry score above which a review is treated as positive.",
  recomputeIntervalMinutes: "How often the whole pipeline recomputes.",
};
