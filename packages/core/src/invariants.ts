import type { Program } from '@grade/schema';
import { EPS, MIN_CLIP_SEC, MIN_SEGMENT_SEC } from './constants';
import { CoreError } from './errors';

/** Returns a list of violated invariants (architecture.md section 5). Empty means valid. */
export function checkProgram(p: Program): string[] {
  const problems: string[] = [];
  const { segments, clips } = p;

  if (segments.length === 0) problems.push('segments is empty');
  segments.forEach((s, i) => {
    if (i === 0 && Math.abs(s.start) > EPS) problems.push('first segment does not start at 0');
    if (i > 0) {
      const prev = segments[i - 1]!;
      if (Math.abs(s.start - prev.end) > EPS) {
        problems.push(`segment ${i} is not contiguous with the previous one`);
      }
    }
    if (s.end - s.start < MIN_SEGMENT_SEC - EPS) {
      problems.push(`segment ${i} is shorter than ${MIN_SEGMENT_SEC}s`);
    }
  });
  if (new Set(segments.map((s) => s.id)).size !== segments.length) {
    problems.push('duplicate segment ids');
  }

  if (clips.length === 0) problems.push('clips is empty');
  if (new Set(clips.map((c) => c.id)).size !== clips.length) problems.push('duplicate clip ids');
  const byId = new Map(segments.map((s) => [s.id, s]));
  clips.forEach((c, i) => {
    const seg = byId.get(c.segmentId);
    if (!seg) {
      problems.push(`clip ${i} references a missing segment`);
      return;
    }
    if (c.start < seg.start - EPS || c.end > seg.end + EPS || c.start >= c.end) {
      problems.push(`clip ${i} is outside its segment`);
    }
    if (c.end - c.start < MIN_CLIP_SEC - EPS) {
      problems.push(`clip ${i} is shorter than ${MIN_CLIP_SEC}s`);
    }
  });
  return problems;
}

export function assertValid(p: Program): void {
  const problems = checkProgram(p);
  if (problems.length > 0) throw new CoreError('invalid_program', problems.join('; '));
}
