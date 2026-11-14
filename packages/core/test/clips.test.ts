import { describe, expect, test } from 'vitest';
import {
  assertValid,
  CoreError,
  duplicateClips,
  generateIntervals,
  removeClips,
  reorderClips,
  trimClip,
} from '../src/index';
import { counterId, makeProgram } from './helpers';

const base = () =>
  makeProgram([
    [20, 'easy', 'intro'],
    [40, 'hard'],
    [30, 'moderate'],
    [20, 'easy', 'outro'],
  ]);
const ids = (p: ReturnType<typeof base>) => p.clips.map((c) => c.id);

describe('reorderClips', () => {
  test('moves one clip forward (target index is pre-removal)', () => {
    expect(ids(reorderClips(base(), [0], 3))).toEqual(['c2', 'c3', 'c1', 'c4']);
  });
  test('moves one clip back', () => {
    expect(ids(reorderClips(base(), [3], 1))).toEqual(['c1', 'c4', 'c2', 'c3']);
  });
  test('moves a group and keeps its relative order', () => {
    expect(ids(reorderClips(base(), [2, 1], 0))).toEqual(['c2', 'c3', 'c1', 'c4']);
    expect(ids(reorderClips(base(), [0, 1], 4))).toEqual(['c3', 'c4', 'c1', 'c2']);
  });
  test('rejects bad input', () => {
    expect(() => reorderClips(base(), [], 0)).toThrow(CoreError);
    expect(() => reorderClips(base(), [9], 0)).toThrow(CoreError);
    expect(() => reorderClips(base(), [0], 9)).toThrow(CoreError);
  });
});

describe('duplicate, remove, trim', () => {
  test('duplicate puts a copy with a new id after each original', () => {
    const p = duplicateClips(base(), [1, 2], { newId: counterId() });
    expect(ids(p)).toEqual(['c1', 'c2', 'n1', 'c3', 'n2', 'c4']);
    expect(p.clips[2]).toMatchObject({ segmentId: 's2', start: 20, end: 60 });
    assertValid(p);
  });
  test('remove drops clips but never empties the order', () => {
    expect(ids(removeClips(base(), [0, 3]))).toEqual(['c2', 'c3']);
    expect(() => removeClips(base(), [0, 1, 2, 3])).toThrowError(/empty/);
  });
  test('trim clamps to the segment and to the minimum length', () => {
    const p = trimClip(base(), 'c2', 5, 100);
    expect(p.clips[1]).toMatchObject({ start: 20, end: 60 });
    const q = trimClip(base(), 'c2', 59.5, 61);
    expect(q.clips[1]!.end - q.clips[1]!.start).toBeGreaterThanOrEqual(1);
    expect(q.clips[1]!.end).toBeLessThanOrEqual(60);
    assertValid(q);
  });
  test('trim of a copy does not affect the original', () => {
    const p = duplicateClips(base(), [1], { newId: counterId() });
    const q = trimClip(p, 'n1', 30, 50);
    expect(q.clips[1]).toMatchObject({ start: 20, end: 60 });
    expect(q.clips[2]).toMatchObject({ start: 30, end: 50 });
  });
  test('trim rejects an unknown clip', () => {
    expect(() => trimClip(base(), 'zzz', 0, 5)).toThrow(CoreError);
  });
});

describe('generateIntervals', () => {
  test('alternates all-out and easy to the end and labels the on parts', () => {
    const { program } = generateIntervals(base(), 60, 20, 10, 'Sprint', { newId: counterId() });
    const gen = program.segments.filter((s) => s.start >= 60);
    expect(gen.map((s) => [s.start, s.end, s.tier, s.label])).toEqual([
      [60, 80, 'allout', 'Sprint'],
      [80, 90, 'easy', null],
      [90, 110, 'allout', 'Sprint'],
    ]);
    assertValid(program);
  });
  test('the kept part keeps its clips and the new clips go last', () => {
    const { program } = generateIntervals(base(), 60, 20, 10, undefined, { newId: counterId() });
    expect(program.clips.slice(0, 2).map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(program.clips).toHaveLength(2 + 3);
  });
  test('truncates the segment that straddles the start', () => {
    const { program } = generateIntervals(base(), 40, 20, 20, undefined, { newId: counterId() });
    expect(program.segments[1]).toMatchObject({ start: 20, end: 40 });
    expect(program.clips[1]).toMatchObject({ id: 'c2', start: 20, end: 40 });
    assertValid(program);
  });
  test('snaps to the segment start when the leftover part would be too short', () => {
    const { program } = generateIntervals(base(), 21, 20, 20, undefined, { newId: counterId() });
    expect(program.segments[1]!.start).toBe(20);
    assertValid(program);
  });
  test('a tail under the minimum joins the last interval', () => {
    const { program } = generateIntervals(makeProgram([[41, 'easy']]), 0, 20, 20, undefined, {
      newId: counterId(),
    });
    expect(program.segments.map((s) => [s.start, s.end])).toEqual([
      [0, 20],
      [20, 41],
    ]);
    assertValid(program);
  });
  test('works from time 0 and replaces everything', () => {
    const { program } = generateIntervals(base(), 0, 30, 30, undefined, { newId: counterId() });
    expect(program.segments[0]!.start).toBe(0);
    expect(program.clips).toHaveLength(program.segments.length);
    assertValid(program);
  });
  test('rejects bad arguments', () => {
    expect(() => generateIntervals(base(), 60, 1, 10)).toThrow(CoreError);
    expect(() => generateIntervals(base(), 109, 10, 10)).toThrow(CoreError);
    expect(() => generateIntervals(base(), -1, 10, 10)).toThrow(CoreError);
  });
});
