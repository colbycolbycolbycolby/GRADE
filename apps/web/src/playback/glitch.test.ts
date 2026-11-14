import { expect, test } from 'vitest';
import { equalPowerCurves, glitchPlan } from './glitch';

test('glitch plan follows Appendix A.3', () => {
  const plan = glitchPlan(10, 0);
  expect(plan).toHaveLength(6);
  expect(plan[0]!.when).toBeCloseTo(10 - 0.35, 6);
  expect(plan[0]!.peak).toBeCloseTo(0.95, 6);
  // spacing after repeat i is grain * max(0.55, 0.92 - 0.05 i)
  expect(plan[1]!.when - plan[0]!.when).toBeCloseTo(0.14 * 0.92, 6);
  expect(plan[2]!.when - plan[1]!.when).toBeCloseTo(0.14 * 0.87, 6);
  [0.95, 0.85, 0.75, 0.65, 0.55, 0.45].forEach((peak, i) =>
    expect(plan[i]!.peak).toBeCloseTo(peak, 6),
  );
  expect(Math.min(...plan.map((g) => g.peak))).toBeGreaterThanOrEqual(0.35);
});

test('glitch plan drops grains that would start in the past', () => {
  const plan = glitchPlan(10, 9.8);
  expect(plan.length).toBeLessThan(6);
  expect(plan.every((g) => g.when >= 9.8)).toBe(true);
  expect(glitchPlan(10, 11)).toEqual([]);
});

test('crossfade curves keep equal power', () => {
  const { fadeOut, fadeIn } = equalPowerCurves();
  for (let i = 0; i < fadeOut.length; i++) {
    expect(fadeOut[i]! ** 2 + fadeIn[i]! ** 2).toBeCloseTo(1, 5);
  }
  expect(fadeOut[0]).toBe(1);
  expect(fadeIn[fadeIn.length - 1]).toBeCloseTo(1, 6);
});
