import { expect, test } from 'vitest';
import { OffsetBackend } from './offset';
import { FakeBackend, FakeClock } from './testkit';

test('converts crop-relative time to file time and back', async () => {
  const clock = new FakeClock();
  const inner = new FakeBackend(clock, true);
  const backend = new OffsetBackend(inner, 3);
  await backend.seek(10);
  expect(inner.seeks).toEqual([13]);
  await backend.play();
  clock.advance(2);
  expect(inner.position).toBeCloseTo(15, 9);
  expect(backend.position).toBeCloseTo(12, 9);
  backend.scheduleJump?.(20, 40, { glitch: true });
  expect(inner.jumps).toEqual([{ atReal: 23, toReal: 43, glitch: true }]);
});

test('keeps the capabilities and has no scheduleJump when the inner has none', () => {
  const plain = new OffsetBackend(new FakeBackend(new FakeClock(), false), 1);
  expect(plain.capabilities.sampleAccurate).toBe(false);
  expect(plain.scheduleJump).toBeUndefined();
});
