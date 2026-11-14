import type { Clip, Program } from '@grade/schema';
import { MIN_CLIP_SEC } from './constants';
import { CoreError } from './errors';
import { defaultNewId, type EditOptions } from './ids';

function checkIndices(p: Program, indices: number[]): number[] {
  const unique = [...new Set(indices)];
  if (unique.length === 0) throw new CoreError('invalid_argument', 'No clips selected');
  for (const i of unique) {
    if (!Number.isInteger(i) || i < 0 || i >= p.clips.length) {
      throw new CoreError('clip_not_found', `No clip at index ${i}`);
    }
  }
  return unique.sort((a, b) => a - b);
}

/**
 * Moves the clips at `fromIndices` together, in their current relative order, to sit just before
 * the clip that is at `toIndex` now (index space before the move). `toIndex` may equal the clip
 * count to move to the end.
 */
export function reorderClips(program: Program, fromIndices: number[], toIndex: number): Program {
  const from = checkIndices(program, fromIndices);
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > program.clips.length) {
    throw new CoreError('invalid_position', `Bad target index ${toIndex}`);
  }
  const moving = from.map((i) => program.clips[i]!);
  const remaining = program.clips.filter((_, i) => !from.includes(i));
  const removedBefore = from.filter((i) => i < toIndex).length;
  remaining.splice(toIndex - removedBefore, 0, ...moving);
  return { ...program, clips: remaining };
}

/** Each copy goes right after its original. Copies get new ids and the same trim window. */
export function duplicateClips(program: Program, indices: number[], opts?: EditOptions): Program {
  const newId = opts?.newId ?? defaultNewId;
  const chosen = new Set(checkIndices(program, indices));
  const clips: Clip[] = [];
  program.clips.forEach((c, i) => {
    clips.push(c);
    if (chosen.has(i)) clips.push({ ...c, id: newId() });
  });
  return { ...program, clips };
}

/** Refuses to empty the class order. */
export function removeClips(program: Program, indices: number[]): Program {
  const chosen = new Set(checkIndices(program, indices));
  const clips = program.clips.filter((_, i) => !chosen.has(i));
  if (clips.length === 0) throw new CoreError('would_empty', 'The class order cannot be empty');
  return { ...program, clips };
}

/** Trims a clip inside its own segment. Values are clamped, never below MIN_CLIP_SEC long. */
export function trimClip(program: Program, clipId: string, start: number, end: number): Program {
  const i = program.clips.findIndex((c) => c.id === clipId);
  if (i < 0) throw new CoreError('clip_not_found', `No clip ${clipId}`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new CoreError('invalid_argument', 'Trim times must be numbers');
  }
  const clip = program.clips[i]!;
  const seg = program.segments.find((s) => s.id === clip.segmentId);
  if (!seg) throw new CoreError('segment_not_found', `No segment ${clip.segmentId}`);
  const s = Math.max(seg.start, Math.min(start, seg.end - MIN_CLIP_SEC));
  const e = Math.min(seg.end, Math.max(end, s + MIN_CLIP_SEC));
  const clips = [...program.clips];
  clips[i] = { ...clip, start: s, end: e };
  return { ...program, clips };
}
