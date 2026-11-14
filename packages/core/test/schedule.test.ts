import { describe, expect, test } from 'vitest';
import {
  buildSchedule,
  classDuration,
  classToRealTime,
  duplicateClips,
  isGenuineCut,
  itemIndexAtClassTime,
  reorderClips,
  segmentTitle,
  setLabel,
  similarityHint,
  trimClip,
} from '../src/index';
import { counterId, makeProgram } from './helpers';

const pick = (items: ReturnType<typeof buildSchedule>) =>
  items.map((i) => [i.title, i.tier, i.realStart, i.realEnd, i.classStart, i.classEnd]);

describe('buildSchedule (hand-computed fixtures)', () => {
  test('fixture 1: untouched program is chronological', () => {
    const p = makeProgram([
      [10, 'easy', 'intro'],
      [30, 'hard'],
      [20, 'allout'],
      [10, 'easy', 'outro'],
    ]);
    expect(pick(buildSchedule(p))).toEqual([
      ['Intro', 'easy', 0, 10, 0, 10],
      ['Section 1', 'hard', 10, 40, 10, 40],
      ['Section 2', 'allout', 40, 60, 40, 60],
      ['Outro', 'easy', 60, 70, 60, 70],
    ]);
  });

  test('fixture 2: reordered, duplicated and trimmed', () => {
    let p = makeProgram([
      [10, 'easy', 'intro'],
      [30, 'hard'],
      [20, 'allout'],
    ]);
    p = setLabel(p, 's3', 'Chorus');
    p = trimClip(p, 'c3', 40, 50); // chorus trimmed to 10s
    p = duplicateClips(p, [2], { newId: counterId() }); // chorus twice
    p = reorderClips(p, [0], 4); // intro to the end
    expect(pick(buildSchedule(p))).toEqual([
      ['Section 1', 'hard', 10, 40, 0, 30],
      ['Chorus', 'allout', 40, 50, 30, 40],
      ['Chorus', 'allout', 40, 50, 40, 50],
      ['Intro', 'easy', 0, 10, 50, 60],
    ]);
  });

  test('fixture 3: a single block', () => {
    const items = buildSchedule(makeProgram([[45.5, 'moderate']]));
    expect(pick(items)).toEqual([['Section 1', 'moderate', 0, 45.5, 0, 45.5]]);
    expect(classDuration(items)).toBe(45.5);
  });
});

describe('schedule helpers', () => {
  const p = makeProgram([
    [10, 'easy'],
    [10, 'hard'],
    [10, 'allout'],
  ]);
  const reordered = reorderClips(p, [2], 0); // s3, s1, s2
  const items = buildSchedule(reordered);

  test('isGenuineCut ignores gaps of 0.05s or less', () => {
    expect(isGenuineCut(10, 10)).toBe(false);
    expect(isGenuineCut(10, 10.05)).toBe(false);
    expect(isGenuineCut(10, 10.06)).toBe(true);
    expect(isGenuineCut(30, 0)).toBe(true);
  });
  test('itemIndexAtClassTime and classToRealTime map class time to song time', () => {
    expect(itemIndexAtClassTime(items, 0)).toBe(0);
    expect(itemIndexAtClassTime(items, 10)).toBe(1);
    expect(itemIndexAtClassTime(items, 999)).toBe(2);
    expect(classToRealTime(items, 5)).toBe(25);
    expect(classToRealTime(items, 12)).toBe(2);
  });
  test('titles number sections by position and skip intro and outro', () => {
    const q = makeProgram([
      [10, 'easy', 'intro'],
      [10, 'hard'],
      [10, 'hard'],
      [10, 'easy', 'outro'],
    ]);
    expect(q.segments.map((s) => segmentTitle(q, s))).toEqual([
      'Intro',
      'Section 1',
      'Section 2',
      'Outro',
    ]);
  });
  test('similarity hint points at the first similar section number', () => {
    const q = makeProgram([
      [10, 'hard'],
      [10, 'easy'],
      [10, 'hard'],
    ]);
    q.segments[2] = { ...q.segments[2]!, similarTo: 's1' };
    expect(similarityHint(q, q.segments[2]!)).toBe('~1');
    expect(similarityHint(q, q.segments[0]!)).toBeNull();
  });
});
