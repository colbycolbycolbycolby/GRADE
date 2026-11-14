import type { Program, Segment } from '@grade/schema';
import { EPS, MIN_SEGMENT_SEC } from './constants';
import { CoreError } from './errors';
import { defaultNewId, type EditOptions } from './ids';
import { defaultClips, reflowClips } from './repair';
import type { Change, EditResult } from './types';

/**
 * Replaces everything from `fromTime` to the end with alternating all-out and easy segments.
 * The all-out segments get `label`. A tail shorter than MIN_SEGMENT_SEC joins the last interval.
 * Clips of the kept part stay; new clips for the intervals go at the end of the class order.
 */
export function generateIntervals(
  program: Program,
  fromTime: number,
  onSec: number,
  offSec: number,
  label?: string,
  opts?: EditOptions,
): EditResult {
  const newId = opts?.newId ?? defaultNewId;
  if (!(onSec >= MIN_SEGMENT_SEC) || !(offSec >= MIN_SEGMENT_SEC)) {
    throw new CoreError('too_short', `Intervals must be at least ${MIN_SEGMENT_SEC}s`);
  }
  const duration = program.segments[program.segments.length - 1]!.end;
  if (!Number.isFinite(fromTime) || fromTime < 0 || duration - fromTime < MIN_SEGMENT_SEC) {
    throw new CoreError('invalid_position', 'Not enough song left after the start time');
  }

  let start = fromTime;
  const kept: Segment[] = [];
  for (const seg of program.segments) {
    if (seg.end <= start + EPS) {
      kept.push(seg);
    } else if (seg.start < start - EPS) {
      if (start - seg.start < MIN_SEGMENT_SEC - EPS) start = seg.start;
      else kept.push({ ...seg, end: start, kind: seg.kind === 'outro' ? 'section' : seg.kind });
      break;
    } else {
      break;
    }
  }

  const trimmedLabel = label?.trim() || null;
  const generated: Segment[] = [];
  let t = start;
  let on = true;
  while (duration - t > EPS) {
    const end = Math.min(t + (on ? onSec : offSec), duration);
    generated.push({
      id: newId(),
      start: t,
      end,
      tier: on ? 'allout' : 'easy',
      label: on ? trimmedLabel : null,
      kind: 'section',
    });
    t = end;
    on = !on;
  }
  const tail = generated[generated.length - 1]!;
  if (generated.length > 1 && tail.end - tail.start < MIN_SEGMENT_SEC - EPS) {
    generated.pop();
    generated[generated.length - 1] = { ...generated[generated.length - 1]!, end: duration };
  }

  const survivingIds = new Set(kept.map((s) => s.id));
  const base = program.clips.filter((c) => survivingIds.has(c.segmentId));
  const reflowed =
    base.length > 0 ? reflowClips(base, kept, newId) : { clips: [], changes: [] as Change[] };
  for (const c of program.clips) {
    if (!survivingIds.has(c.segmentId)) {
      reflowed.changes.push({
        kind: 'clip-dropped',
        clipId: c.id,
        reason: 'replaced by intervals',
      });
    }
  }
  const clips = [...reflowed.clips, ...defaultClips(generated, newId)];
  return {
    program: { ...program, segments: [...kept, ...generated], clips },
    changes: reflowed.changes,
  };
}
