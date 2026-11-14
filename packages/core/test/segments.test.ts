import { describe, expect, test } from 'vitest';
import {
  assertValid,
  CoreError,
  deleteSegment,
  mergeIntoPrevious,
  moveBoundary,
  setLabel,
  setTier,
  splitSegment,
} from '../src/index';
import { counterId, makeProgram } from './helpers';

const base = () =>
  makeProgram([
    [20, 'easy', 'intro'],
    [40, 'hard'],
    [30, 'moderate'],
    [20, 'easy', 'outro'],
  ]);

describe('splitSegment', () => {
  test('splits, keeps the label on the first part only, and keeps invariants', () => {
    const p = setLabel(base(), 's2', 'Climb');
    const { program, changes } = splitSegment(p, 's2', 35, { newId: counterId() });
    expect(program.segments.map((s) => [s.start, s.end])).toEqual([
      [0, 20],
      [20, 35],
      [35, 60],
      [60, 90],
      [90, 110],
    ]);
    expect(program.segments[1]!.label).toBe('Climb');
    expect(program.segments[2]!.label).toBeNull();
    expect(program.segments[2]!.tier).toBe('hard');
    expect(changes).toEqual([{ kind: 'clip-split', clipId: 'c2', newClipId: 'n2' }]);
    assertValid(program);
  });

  test('a clip that straddles the split is cut in two', () => {
    const { program, changes } = splitSegment(base(), 's2', 35, { newId: counterId() });
    const parts = program.clips.filter((c) => c.start >= 20 && c.end <= 60);
    expect(parts.map((c) => [c.start, c.end])).toEqual([
      [20, 35],
      [35, 60],
    ]);
    expect(changes.some((c) => c.kind === 'clip-split')).toBe(true);
    assertValid(program);
  });

  test('splitting an intro keeps the intro first and makes the rest a section', () => {
    const { program } = splitSegment(base(), 's1', 10, { newId: counterId() });
    expect(program.segments.slice(0, 2).map((s) => s.kind)).toEqual(['intro', 'section']);
  });

  test('splitting an outro keeps the outro last', () => {
    const { program } = splitSegment(base(), 's4', 100, { newId: counterId() });
    expect(program.segments.slice(-2).map((s) => s.kind)).toEqual(['section', 'outro']);
  });

  test('rejects parts shorter than the minimum', () => {
    expect(() => splitSegment(base(), 's2', 21)).toThrow(CoreError);
    expect(() => splitSegment(base(), 's2', 59)).toThrowError(/at least/);
  });

  test('rejects an unknown segment', () => {
    expect(() => splitSegment(base(), 'nope', 30)).toThrowError(/No segment/);
  });
});

describe('mergeIntoPrevious', () => {
  test('joins two segments and remaps clips into the merged one', () => {
    const { program, changes } = mergeIntoPrevious(base(), 's3');
    expect(program.segments.map((s) => [s.start, s.end])).toEqual([
      [0, 20],
      [20, 90],
      [90, 110],
    ]);
    expect(program.clips).toHaveLength(4);
    expect(program.clips.some((c) => c.segmentId === 's3')).toBe(false);
    expect(changes.filter((c) => c.kind === 'clip-remapped')).toHaveLength(1);
    assertValid(program);
  });

  test('merging an outro into a section makes the result the outro', () => {
    const { program } = mergeIntoPrevious(base(), 's4');
    expect(program.segments[program.segments.length - 1]!.kind).toBe('outro');
  });

  test('the first segment cannot merge', () => {
    expect(() => mergeIntoPrevious(base(), 's1')).toThrow(CoreError);
  });

  test('clears similarTo links that pointed at the removed segment', () => {
    const p = base();
    p.segments[3] = { ...p.segments[3]!, similarTo: 's3' };
    const { program } = mergeIntoPrevious(p, 's3');
    expect(program.segments[2]!.similarTo).toBeUndefined();
  });
});

describe('deleteSegment', () => {
  test('the next segment absorbs the time and its clips are dropped', () => {
    const { program, changes } = deleteSegment(base(), 's2');
    expect(program.segments.map((s) => [s.id, s.start, s.end])).toEqual([
      ['s1', 0, 20],
      ['s3', 20, 90],
      ['s4', 90, 110],
    ]);
    expect(program.clips.map((c) => c.segmentId)).toEqual(['s1', 's3', 's4']);
    expect(changes).toEqual([{ kind: 'clip-dropped', clipId: 'c2', reason: expect.any(String) }]);
    assertValid(program);
  });

  test('deleting the last segment extends the previous one', () => {
    const { program } = deleteSegment(base(), 's4');
    expect(program.segments[2]!.end).toBe(110);
    assertValid(program);
  });

  test('refuses to delete the only segment', () => {
    expect(() => deleteSegment(makeProgram([[10, 'easy']]), 's1')).toThrowError(/at least one/);
  });

  test('falls back to chronological order when every clip would be lost', () => {
    const p = { ...base(), clips: [base().clips[1]!] };
    const { program, changes } = deleteSegment(p, 's2', { newId: counterId() });
    expect(changes.some((c) => c.kind === 'order-reset')).toBe(true);
    expect(program.clips).toHaveLength(3);
    assertValid(program);
  });
});

describe('moveBoundary', () => {
  test('moves the boundary and moves clip time across with it', () => {
    const { program, changes } = moveBoundary(base(), 1, 50, { newId: counterId() });
    expect(program.segments[1]!.end).toBe(50);
    expect(program.segments[2]!.start).toBe(50);
    // Clip c2 (20..60) is cut at 50 and c3 (60..90) now starts at 50 in the next segment.
    const c2 = program.clips.filter((c) => c.start >= 20 && c.end <= 50);
    expect(c2).toHaveLength(1);
    expect(changes.length).toBeGreaterThan(0);
    assertValid(program);
  });

  test('enforces the minimum on both sides', () => {
    expect(() => moveBoundary(base(), 1, 21)).toThrow(CoreError);
    expect(() => moveBoundary(base(), 1, 89)).toThrow(CoreError);
  });

  test('rejects a bad index', () => {
    expect(() => moveBoundary(base(), 3, 100)).toThrow(CoreError);
    expect(() => moveBoundary(base(), -1, 10)).toThrow(CoreError);
  });
});

describe('tier and label', () => {
  test('setTier changes only the tier', () => {
    expect(setTier(base(), 's2', 'allout').segments[1]!.tier).toBe('allout');
  });
  test('blank label becomes null; the title is never stored', () => {
    const p = setLabel(setLabel(base(), 's2', 'X'), 's2', '   ');
    expect(p.segments[1]!.label).toBeNull();
  });
});
