import type { Clip, Segment } from '@grade/schema';
import { EPS, MIN_CLIP_SEC } from './constants';
import type { NewId } from './ids';
import type { Change } from './types';

export function defaultClips(segments: Segment[], newId: NewId): Clip[] {
  return segments.map((s) => ({ id: newId(), segmentId: s.id, start: s.start, end: s.end }));
}

/**
 * Re-fits clips onto a new segment layout. Clips are real time, so each clip is cut at the new
 * segment edges it crosses. Pieces shorter than MIN_CLIP_SEC are dropped. If nothing survives,
 * the order falls back to chronological.
 */
export function reflowClips(
  clips: Clip[],
  segments: Segment[],
  newId: NewId,
): { clips: Clip[]; changes: Change[] } {
  const changes: Change[] = [];
  const out: Clip[] = [];

  for (const clip of clips) {
    const own = segments.find((s) => s.id === clip.segmentId);
    if (own && clip.start >= own.start - EPS && clip.end <= own.end + EPS) {
      out.push({
        ...clip,
        start: Math.max(clip.start, own.start),
        end: Math.min(clip.end, own.end),
      });
      continue;
    }

    const pieces: { segment: Segment; start: number; end: number }[] = [];
    for (const seg of segments) {
      const start = Math.max(clip.start, seg.start);
      const end = Math.min(clip.end, seg.end);
      if (end - start > EPS) pieces.push({ segment: seg, start, end });
    }
    const kept = pieces.filter((p) => p.end - p.start >= MIN_CLIP_SEC - EPS);

    if (kept.length === 0) {
      changes.push({ kind: 'clip-dropped', clipId: clip.id, reason: 'no part is long enough' });
      continue;
    }
    if (kept.length < pieces.length) changes.push({ kind: 'clip-trimmed', clipId: clip.id });

    kept.forEach((piece, i) => {
      const id = i === 0 ? clip.id : newId();
      if (i > 0) changes.push({ kind: 'clip-split', clipId: clip.id, newClipId: id });
      if (piece.segment.id !== clip.segmentId && i === 0) {
        changes.push({
          kind: 'clip-remapped',
          clipId: clip.id,
          fromSegmentId: clip.segmentId,
          toSegmentId: piece.segment.id,
        });
      }
      out.push({ id, segmentId: piece.segment.id, start: piece.start, end: piece.end });
    });
  }

  if (out.length === 0) {
    changes.push({ kind: 'order-reset' });
    return { clips: defaultClips(segments, newId), changes };
  }
  return { clips: out, changes };
}

/** Removes similarTo links that point at a segment that is gone or no longer earlier. */
export function cleanSimilarTo(segments: Segment[]): Segment[] {
  const order = new Map(segments.map((s, i) => [s.id, i]));
  return segments.map((s, i) => {
    if (s.similarTo === undefined) return s;
    const target = order.get(s.similarTo);
    if (target !== undefined && target < i) return s;
    const { similarTo: _dropped, ...rest } = s;
    void _dropped;
    return rest;
  });
}
