import { describe, expect, test } from 'vitest';
import type { Analysis } from '@grade/schema';
import {
  canRedo,
  canUndo,
  commit,
  CoreError,
  createHistory,
  parseProgram,
  programFromAnalysis,
  redo,
  serializeProgram,
  tierForEnergy,
  undo,
  checkProgram,
} from '../src/index';
import { counterId, makeProgram } from './helpers';

describe('serialization', () => {
  const p = makeProgram([
    [20, 'easy'],
    [20, 'hard'],
  ]);
  test('round-trips', () => {
    expect(parseProgram(serializeProgram(p))).toEqual(p);
  });
  test('rejects bad JSON, wrong version and broken invariants', () => {
    expect(() => parseProgram('{nope')).toThrow(CoreError);
    expect(() => parseProgram({ schemaVersion: 2, program: p })).toThrowError(/version/);
    const broken = { ...p, clips: [{ ...p.clips[0]!, segmentId: 'zzz' }] };
    expect(() => parseProgram({ schemaVersion: 1, program: broken })).toThrowError(/missing/);
    expect(() => parseProgram({ schemaVersion: 1, program: { ...p, clips: [] } })).toThrow(
      CoreError,
    );
  });
});

describe('history', () => {
  test('undo and redo walk the snapshots; a new commit clears redo', () => {
    let h = createHistory(1);
    h = commit(commit(h, 2), 3);
    expect(h.present).toBe(3);
    h = undo(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(3);
    h = commit(undo(h), 9);
    expect(canRedo(h)).toBe(false);
    expect(h.past).toEqual([1, 2]);
  });
  test('throws when empty and caps the stack', () => {
    expect(() => undo(createHistory(1))).toThrow(CoreError);
    let h = createHistory(0, 3);
    for (let i = 1; i <= 10; i++) h = commit(h, i);
    expect(h.past).toHaveLength(3);
    expect(canUndo(h)).toBe(true);
  });
  test('committing the same value does nothing', () => {
    const h = createHistory({ a: 1 });
    expect(commit(h, h.present)).toBe(h);
  });
});

describe('programFromAnalysis', () => {
  const analysis: Analysis = {
    trackId: 'yt:dQw4w9WgXcQ',
    version: 1,
    duration: 130,
    energy: Array.from({ length: 1300 }, (_, i) => ({
      t: i / 10,
      e: i / 10 < 40 ? 0.1 : i / 10 < 80 ? 0.5 : 0.9,
    })),
    boundaries: [40, 80],
    structure: [{ kind: 'intro' }, { kind: 'section' }, { kind: 'section', similarTo: 1 }],
    cropStart: 10,
    cropEnd: 120,
    createdAt: 'x',
  };
  test('shifts times by cropStart and derives tiers from energy', () => {
    const p = programFromAnalysis(analysis, { name: 'N', now: 't' }, { newId: counterId() });
    expect(p.segments.map((s) => [s.start, s.end, s.tier, s.kind])).toEqual([
      [0, 30, 'easy', 'intro'],
      [30, 70, 'hard', 'section'],
      [70, 110, 'allout', 'section'],
    ]);
    expect(p.segments[2]!.similarTo).toBe(p.segments[1]!.id);
    expect(p.clips).toHaveLength(3);
    expect(checkProgram(p)).toEqual([]);
  });
  test('drops boundaries that would make a part too short', () => {
    const p = programFromAnalysis(
      { ...analysis, boundaries: [40, 40.5, 119], structure: undefined },
      {
        name: 'N',
        now: 't',
      },
    );
    expect(p.segments).toHaveLength(2);
    expect(checkProgram(p)).toEqual([]);
  });
  test('tier thresholds', () => {
    expect([0.28, 0.29, 0.44, 0.45, 0.62, 0.63].map(tierForEnergy)).toEqual([
      'easy',
      'moderate',
      'moderate',
      'hard',
      'hard',
      'allout',
    ]);
  });
});
