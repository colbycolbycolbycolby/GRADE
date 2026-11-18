import { describe, expect, test } from 'vitest';
import {
  addProgramTag,
  normalizeTag,
  programWorkoutMetadata,
  recognizeWorkoutTitle,
  removeProgramTag,
} from '../src/index';
import { makeProgram } from './helpers';

describe('workout intelligence', () => {
  test('normalizes, deduplicates, and removes tags', () => {
    expect(normalizeTag(' 100 RPM   Sprint ')).toBe('100_rpm_sprint');
    let program = makeProgram([[30, 'easy']]);
    program = addProgramTag(program, ' Rolling Hills ');
    program = addProgramTag(program, 'rolling   hills');
    expect(program.tags).toEqual(['rolling_hills']);
    expect(removeProgramTag(program, 'rolling_hills').tags).toEqual([]);
  });

  test.each([
    ['Z2 70 Seated', { resistanceZone: 2, cadence: { minRpm: 70 }, position: 'seated' }],
    [
      'Z4 50-60 Standing',
      { resistanceZone: 4, cadence: { minRpm: 50, maxRpm: 60 }, position: 'standing' },
    ],
    [
      'Z3 80–90 Mixed',
      { resistanceZone: 3, cadence: { minRpm: 80, maxRpm: 90 }, position: 'mixed' },
    ],
  ])('recognizes %s', (title, expected) => {
    expect(recognizeWorkoutTitle(title)).toEqual(expected);
  });

  test('leaves missing or ambiguous values unset and sprint does not imply exertion or zone', () => {
    expect(recognizeWorkoutTitle('Sprint')).toEqual({});
    expect(recognizeWorkoutTitle('Z7 70 Seated Standing')).toEqual({ cadence: { minRpm: 70 } });
    expect(recognizeWorkoutTitle('Z2 90-70 Seated')).toEqual({
      resistanceZone: 2,
      position: 'seated',
    });
  });

  test('planner metadata preserves program/version identity, titles, boundaries, and duration', () => {
    const program = makeProgram([[30, 'hard']]);
    program.tags = ['hill'];
    program.workoutFormat = 'hills_climb';
    program.segments[0] = { ...program.segments[0]!, label: 'Z3 80 Seated' };
    expect(programWorkoutMetadata(program)).toMatchObject({
      programId: 'p',
      analysisVersion: 1,
      tags: ['hill'],
      workoutFormat: 'hills_climb',
      segments: [
        {
          title: 'Z3 80 Seated',
          start: 0,
          end: 30,
          duration: 30,
          exertion: 'hard',
          resistanceZone: 3,
          cadence: { minRpm: 80 },
          position: 'seated',
        },
      ],
    });
  });
});
