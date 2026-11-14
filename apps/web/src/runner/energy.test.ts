import { buildSchedule } from '@grade/core';
import { describe, expect, test } from 'vitest';
import { makeAnalysis, makeProgram } from '../testing/fixtures';
import { classEnergy, energyAt } from './energy';

describe('classEnergy', () => {
  test('covers the class once, in class time', () => {
    const analysis = makeAnalysis();
    const schedule = buildSchedule(makeProgram());
    const points = classEnergy(analysis, schedule);
    expect(points[0]!.t).toBeCloseTo(0, 6);
    expect(points[points.length - 1]!.t).toBeLessThan(schedule[schedule.length - 1]!.classEnd);
    for (let i = 1; i < points.length; i++) expect(points[i]!.t).toBeGreaterThan(points[i - 1]!.t);
  });

  test('a repeated clip appears twice', () => {
    const analysis = makeAnalysis();
    const program = makeProgram();
    const first = program.clips[0]!;
    const doubled = { ...program, clips: [first, { ...first, id: 'dup' }] };
    const once = classEnergy(analysis, buildSchedule({ ...program, clips: [first] }));
    expect(classEnergy(analysis, buildSchedule(doubled))).toHaveLength(once.length * 2);
  });
});

describe('energyAt', () => {
  test('reads crop-relative time', () => {
    const analysis = makeAnalysis(); // cropStart 2; energy 0.2 for the first 30 s after the crop
    expect(energyAt(analysis, 1)).toBeCloseTo(0.2, 6);
    expect(energyAt(analysis, 40)).toBeCloseTo(0.4, 6);
  });
  test('clamps past the end', () => {
    expect(energyAt(makeAnalysis(), 10_000)).toBeGreaterThanOrEqual(0);
  });
});
