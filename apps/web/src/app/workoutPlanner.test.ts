import { describe, expect, test } from 'vitest';
import type { Program } from '@grade/schema';
import { isInstructorProgram, parseWorkoutRequest, planWorkout } from './workoutPlanner';

function program(id: string, name: string, label: string, seconds = 300): Program {
  return {
    id,
    name,
    trackId: `track-${id}`,
    analysisVersion: 1,
    updatedAt: '2026-01-01',
    segments: [
      {
        id: `s-${id}`,
        start: 0,
        end: seconds,
        tier: label.includes('Z4') ? 'hard' : 'moderate',
        label,
        kind: 'section',
      },
    ],
    clips: [{ id: `c-${id}`, segmentId: `s-${id}`, start: 0, end: seconds }],
  };
}

describe('workout planner', () => {
  test('parses demo constraints', () => {
    expect(
      parseWorkoutRequest(
        'Build a 30-minute cycling class with a warmup, two climbs, sprint intervals, and a cooldown.',
      ),
    ).toMatchObject({
      minutes: 30,
      roles: ['warmup', 'climb', 'climb', 'intervals', 'sprint', 'cooldown'],
    });
  });
  test('excludes AI drafts and unprogrammed songs', () => {
    expect(isInstructorProgram(program('a', 'Song — AI draft', 'Z4 60 standing'))).toBe(false);
    expect(isInstructorProgram(program('b', 'Song', ''))).toBe(false);
  });
  test('returns only original unique Program IDs and reports duration compromise', () => {
    const source = [
      program('warm', 'Warm', 'warmup Z2 80 seated'),
      program('hill', 'Hill', 'climb Z4 60 standing'),
      program('cool', 'Cool', 'cooldown Z2 75 seated'),
      program('draft', 'Fake — AI draft', 'sprint Z4 120 standing'),
    ];
    const result = planWorkout(
      source,
      'Build a 20-minute class with a warmup, climb, sprint, and cooldown',
    );
    expect(result.entries.map((entry) => entry.programId)).toEqual(['warm', 'hill', 'cool']);
    expect(new Set(result.entries.map((entry) => entry.programId)).size).toBe(
      result.entries.length,
    );
    expect(result.shortfalls.join(' ')).toMatch(/sprint|20 minutes/);
  });
});
