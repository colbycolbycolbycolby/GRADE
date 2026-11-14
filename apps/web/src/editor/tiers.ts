import { TIERS } from '@grade/schema';
import type { Tier } from '@grade/schema';

export const TIER_LABEL: Record<Tier, string> = {
  easy: 'Easy',
  moderate: 'Moderate',
  hard: 'Hard',
  allout: 'All out',
};

export const TIER_LIST: readonly Tier[] = TIERS;

/** What the instructor sees on the runner screen. */
export const CUE_TEXT: Record<Tier, string> = {
  easy: 'Ease up',
  moderate: 'Building',
  hard: 'Push',
  allout: 'All out',
};
