export type { Analysis, Clip, ClassPlan, Program, Segment, Tier, Track } from '@grade/schema';

/** What a structural edit did to the class order, so the UI can tell the user. */
export type Change =
  | { kind: 'clip-remapped'; clipId: string; fromSegmentId: string; toSegmentId: string }
  | { kind: 'clip-split'; clipId: string; newClipId: string }
  | { kind: 'clip-trimmed'; clipId: string }
  | { kind: 'clip-dropped'; clipId: string; reason: string }
  | { kind: 'order-reset' };

export interface EditResult {
  program: import('@grade/schema').Program;
  changes: Change[];
}
