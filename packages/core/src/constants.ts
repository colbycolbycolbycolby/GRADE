export const MIN_SEGMENT_SEC = 2;
export const MIN_CLIP_SEC = 1;
/** A cut is genuine when the next clip start differs from the current clip end by more than this. */
export const GENUINE_CUT_SEC = 0.05;
/** Tolerance for float comparisons of times. */
export const EPS = 1e-6;
/** Energy above each threshold selects the tier: easy, moderate, hard, allout. */
export const TIER_THRESHOLDS = [0.28, 0.44, 0.62] as const;
