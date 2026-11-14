import type { Program, Segment } from '@grade/schema';
import { EPS, MIN_SEGMENT_SEC } from './constants';
import { CoreError } from './errors';
import { defaultNewId, type EditOptions } from './ids';
import { cleanSimilarTo, reflowClips } from './repair';
import type { EditResult } from './types';

function indexOfSegment(p: Program, segmentId: string): number {
  const i = p.segments.findIndex((s) => s.id === segmentId);
  if (i < 0) throw new CoreError('segment_not_found', `No segment ${segmentId}`);
  return i;
}

function finish(
  p: Program,
  segments: Segment[],
  base: typeof p.clips,
  opts?: EditOptions,
): EditResult {
  const newId = opts?.newId ?? defaultNewId;
  const cleaned = cleanSimilarTo(segments);
  const { clips, changes } = reflowClips(base, cleaned, newId);
  return { program: { ...p, segments: cleaned, clips }, changes };
}

export function splitSegment(
  program: Program,
  segmentId: string,
  at: number,
  opts?: EditOptions,
): EditResult {
  const newId = opts?.newId ?? defaultNewId;
  const i = indexOfSegment(program, segmentId);
  const seg = program.segments[i]!;
  if (!Number.isFinite(at)) throw new CoreError('invalid_position', 'Split time is not a number');
  if (at - seg.start < MIN_SEGMENT_SEC - EPS || seg.end - at < MIN_SEGMENT_SEC - EPS) {
    throw new CoreError('too_short', `Each part must be at least ${MIN_SEGMENT_SEC}s`);
  }
  // The new part never copies the label, so default titles stay unique.
  const first: Segment = { ...seg, end: at, kind: seg.kind === 'outro' ? 'section' : seg.kind };
  const second: Segment = {
    id: newId(),
    start: at,
    end: seg.end,
    tier: seg.tier,
    label: null,
    kind: seg.kind === 'intro' ? 'section' : seg.kind,
  };
  const segments = [...program.segments];
  segments.splice(i, 1, first, second);
  return finish(program, segments, program.clips, opts);
}

export function mergeIntoPrevious(
  program: Program,
  segmentId: string,
  opts?: EditOptions,
): EditResult {
  const i = indexOfSegment(program, segmentId);
  if (i === 0) throw new CoreError('invalid_position', 'The first segment has no previous one');
  const prev = program.segments[i - 1]!;
  const seg = program.segments[i]!;
  const merged: Segment = {
    ...prev,
    end: seg.end,
    kind: seg.kind === 'outro' && prev.kind === 'section' ? 'outro' : prev.kind,
  };
  const segments = [...program.segments];
  segments.splice(i - 1, 2, merged);
  return finish(program, segments, program.clips, opts);
}

/** The next segment (or the previous one, for the last segment) absorbs the freed time. */
export function deleteSegment(program: Program, segmentId: string, opts?: EditOptions): EditResult {
  const i = indexOfSegment(program, segmentId);
  if (program.segments.length <= 1) {
    throw new CoreError('would_empty', 'A program needs at least one segment');
  }
  const seg = program.segments[i]!;
  const segments = [...program.segments];
  segments.splice(i, 1);
  if (i < segments.length) {
    segments[i] = { ...segments[i]!, start: seg.start };
  } else {
    segments[i - 1] = { ...segments[i - 1]!, end: seg.end };
  }
  const droppedIds = program.clips.filter((c) => c.segmentId === segmentId).map((c) => c.id);
  const kept = program.clips.filter((c) => c.segmentId !== segmentId);
  const result = finish(program, segments, kept, opts);
  for (const clipId of droppedIds) {
    result.changes.unshift({ kind: 'clip-dropped', clipId, reason: 'its segment was deleted' });
  }
  return result;
}

/** `index` is the boundary between segments[index] and segments[index + 1]. */
export function moveBoundary(
  program: Program,
  index: number,
  to: number,
  opts?: EditOptions,
): EditResult {
  if (!Number.isInteger(index) || index < 0 || index >= program.segments.length - 1) {
    throw new CoreError('invalid_position', `No boundary ${index}`);
  }
  const left = program.segments[index]!;
  const right = program.segments[index + 1]!;
  if (
    !Number.isFinite(to) ||
    to - left.start < MIN_SEGMENT_SEC - EPS ||
    right.end - to < MIN_SEGMENT_SEC - EPS
  ) {
    throw new CoreError('too_short', `Each segment must stay at least ${MIN_SEGMENT_SEC}s`);
  }
  const segments = [...program.segments];
  segments[index] = { ...left, end: to };
  segments[index + 1] = { ...right, start: to };
  return finish(program, segments, program.clips, opts);
}

export function setTier(program: Program, segmentId: string, tier: Segment['tier']): Program {
  const i = indexOfSegment(program, segmentId);
  const segments = [...program.segments];
  segments[i] = { ...segments[i]!, tier };
  return { ...program, segments };
}

/** An empty or blank label clears the label, so the generated title shows again. */
export function setLabel(program: Program, segmentId: string, label: string | null): Program {
  const i = indexOfSegment(program, segmentId);
  const trimmed = label?.trim() ?? '';
  const segments = [...program.segments];
  segments[i] = { ...segments[i]!, label: trimmed === '' ? null : trimmed };
  return { ...program, segments };
}
