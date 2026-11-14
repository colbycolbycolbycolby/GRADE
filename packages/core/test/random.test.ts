import { describe, expect, test } from 'vitest';
import type { Program } from '@grade/schema';
import {
  checkProgram,
  CoreError,
  deleteSegment,
  duplicateClips,
  generateIntervals,
  mergeIntoPrevious,
  moveBoundary,
  removeClips,
  reorderClips,
  setLabel,
  setTier,
  splitSegment,
  trimClip,
} from '../src/index';
import { counterId, makeProgram, mulberry32 } from './helpers';

function step(p: Program, rnd: () => number, newId: () => string): Program {
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const seg = pick(p.segments);
  const clipIdx = Math.floor(rnd() * p.clips.length);
  const total = p.segments[p.segments.length - 1]!.end;
  switch (Math.floor(rnd() * 11)) {
    case 0:
      return splitSegment(p, seg.id, seg.start + rnd() * (seg.end - seg.start), { newId }).program;
    case 1:
      return mergeIntoPrevious(p, seg.id, { newId }).program;
    case 2:
      return deleteSegment(p, seg.id, { newId }).program;
    case 3:
      return moveBoundary(p, Math.floor(rnd() * p.segments.length), rnd() * total, { newId })
        .program;
    case 4:
      return reorderClips(p, [clipIdx], Math.floor(rnd() * (p.clips.length + 1)));
    case 5:
      return duplicateClips(p, [clipIdx], { newId });
    case 6:
      return removeClips(
        p,
        p.clips.map((_, i) => i).filter(() => rnd() < 0.6),
      );
    case 7: {
      const clip = p.clips[clipIdx]!;
      return trimClip(p, clip.id, clip.start + rnd() * 10 - 5, clip.end + rnd() * 10 - 5);
    }
    case 8:
      return generateIntervals(p, rnd() * total, 2 + rnd() * 30, 2 + rnd() * 30, 'x', { newId })
        .program;
    case 9:
      return setTier(p, seg.id, 'hard');
    default:
      return setLabel(p, seg.id, rnd() < 0.5 ? 'L' : '');
  }
}

describe('random edit sequences', () => {
  test('invariants always hold and the clip list is never empty', () => {
    let applied = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const rnd = mulberry32(seed);
      const newId = counterId(`r${seed}-`);
      let p = makeProgram([
        [15, 'easy', 'intro'],
        [40, 'hard'],
        [25, 'moderate'],
        [40, 'allout'],
        [15, 'easy', 'outro'],
      ]);
      for (let i = 0; i < 80; i++) {
        try {
          p = step(p, rnd, newId);
          applied++;
        } catch (e) {
          if (!(e instanceof CoreError)) throw e; // only typed errors are allowed
        }
        expect(checkProgram(p), `seed ${seed} step ${i}`).toEqual([]);
        expect(p.clips.length).toBeGreaterThan(0);
      }
    }
    expect(applied).toBeGreaterThan(1000);
  });
});
