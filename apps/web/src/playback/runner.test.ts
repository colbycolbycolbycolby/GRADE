import { describe, expect, test } from 'vitest';
import { ClassRunner, type RunnerEvents } from './runner';
import { FakeBackend, FakeClock, item, sampleSchedule } from './testkit';

function setup(
  sampleAccurate: boolean,
  options: ConstructorParameters<typeof ClassRunner>[2] = {},
) {
  const clock = new FakeClock();
  const backend = new FakeBackend(clock, sampleAccurate);
  const runner = new ClassRunner(backend, sampleSchedule(), { clock, ...options });
  const blocks: { at: number; index: number }[] = [];
  const ticks: RunnerEvents['tick'][] = [];
  let endedAt: number | null = null;
  runner.on('blockChanged', (e) => blocks.push({ at: clock.now(), index: e.index }));
  runner.on('tick', (e) => ticks.push(e));
  runner.on('classEnded', () => (endedAt = clock.now()));
  return { clock, backend, runner, blocks, ticks, ended: () => endedAt };
}

describe.each([false, true])('cues (sampleAccurate=%s)', (sampleAccurate) => {
  test('blockChanged fires at each scheduled start, within one tick', async () => {
    const { clock, runner, blocks } = setup(sampleAccurate);
    await runner.start();
    clock.advance(41);
    expect(blocks.map((b) => b.index)).toEqual([0, 1, 2, 3]);
    const starts = [0, 10, 20, 30];
    blocks.forEach((b, i) => {
      expect(b.at).toBeGreaterThanOrEqual(starts[i]! - 1e-9);
      expect(b.at - starts[i]!).toBeLessThanOrEqual(0.05 + 1e-9);
    });
  });

  test('classEnded fires once at the end of the class and the backend pauses', async () => {
    const { clock, backend, runner, ended } = setup(sampleAccurate);
    let count = 0;
    runner.on('classEnded', () => count++);
    await runner.start();
    clock.advance(39.9);
    expect(ended()).toBeNull();
    clock.advance(1);
    expect(ended()).toBeGreaterThanOrEqual(40);
    expect(ended()).toBeLessThanOrEqual(40.05 + 1e-9);
    expect(count).toBe(1);
    expect(backend.playing).toBe(false);
    expect(runner.isPlaying).toBe(false);
    clock.advance(10);
    expect(count).toBe(1);
  });

  test('tick reports time left in the block and in the class', async () => {
    const { clock, runner, ticks } = setup(sampleAccurate);
    await runner.start();
    clock.advance(12);
    const last = ticks[ticks.length - 1]!;
    expect(last.index).toBe(1);
    expect(last.classTime).toBeCloseTo(12, 1);
    expect(last.blockRemaining).toBeCloseTo(8, 1);
    expect(last.classRemaining).toBeCloseTo(28, 1);
  });

  test('blockChanged lists the next three blocks', async () => {
    const { runner } = setup(sampleAccurate);
    let upcoming: number[] = [];
    runner.on('blockChanged', (e) => {
      if (e.index === 0) upcoming = e.upcoming.map((u) => u.classStart);
    });
    await runner.start();
    expect(upcoming).toEqual([10, 20, 30]);
  });

  test('pause freezes class time and resume continues', async () => {
    const { clock, backend, runner } = setup(sampleAccurate);
    await runner.start();
    clock.advance(5);
    runner.pause();
    const frozen = runner.classTime;
    clock.advance(30);
    expect(runner.classTime).toBe(frozen);
    expect(backend.playing).toBe(false);
    await runner.resume();
    clock.advance(5);
    expect(runner.classTime).toBeCloseTo(frozen + 5, 1);
  });

  test('skip moves class time and seeks to the matching real time', async () => {
    const { clock, backend, runner, blocks } = setup(sampleAccurate);
    await runner.start();
    clock.advance(5);
    await runner.skip(10);
    expect(runner.classTime).toBeCloseTo(15, 1);
    expect(runner.index).toBe(1);
    expect(backend.seeks[backend.seeks.length - 1]).toBeCloseTo(15, 1);
    await runner.skip(-10);
    expect(runner.index).toBe(0);
    expect(backend.seeks[backend.seeks.length - 1]).toBeCloseTo(5, 1);
    await runner.skip(15);
    expect(runner.index).toBe(2);
    expect(backend.seeks[backend.seeks.length - 1]).toBeCloseTo(40, 1);
    expect(blocks.map((b) => b.index)).toEqual([0, 1, 0, 2]);
  });

  test('skip past the end stays inside the last block', async () => {
    const { runner } = setup(sampleAccurate);
    await runner.start();
    await runner.skip(500);
    expect(runner.index).toBe(3);
    expect(runner.classTime).toBeLessThan(40);
  });
});

describe('backend without audio-clock cuts', () => {
  test('seeks only at genuine cuts', async () => {
    const { clock, backend, runner } = setup(false);
    await runner.start();
    expect(backend.seeks).toEqual([0]);
    clock.advance(10.1); // 0-10 -> 10-20 is contiguous
    expect(backend.seeks).toEqual([0]);
    clock.advance(10); // 10-20 -> 40-50 is a cut
    expect(backend.seeks).toEqual([0, 40]);
    clock.advance(10); // 40-50 -> 40-50 is a cut back
    expect(backend.seeks).toEqual([0, 40, 40]);
  });

  test('a long gap seeks once to the place that matches class time', async () => {
    const { clock, backend, runner } = setup(false);
    await runner.start();
    // The page was in the background: one big step instead of many small ones.
    const timers = clock as unknown as { timers: unknown[] };
    timers.timers.length = 0;
    clock.advance(25);
    (runner as unknown as { step(): void }).step();
    expect(backend.seeks).toEqual([0, 45]);
  });

  test('drift beyond one second moves the backend back', async () => {
    const { clock, backend, runner } = setup(false);
    await runner.start();
    clock.advance(3);
    backend.offset = 1.5;
    clock.advance(1.2);
    expect(backend.seeks.length).toBe(2);
    expect(backend.seeks[1]).toBeCloseTo(3.05, 1); // class time at the check
  });
});

describe('sample-accurate backend', () => {
  test('queues only genuine cuts, a few items ahead, and never seeks at a block change', async () => {
    const { clock, backend, runner } = setup(true);
    await runner.start();
    // Lookahead 2 from item 0 covers boundaries 0, 1 and 2. Only 1 -> 2 and 2 -> 3 are cuts.
    expect(backend.jumps).toEqual([
      { atReal: 20, toReal: 40, glitch: false },
      { atReal: 50, toReal: 40, glitch: false },
    ]);
    clock.advance(40);
    expect(backend.seeks).toEqual([0]);
    expect(backend.jumps).toHaveLength(2);
  });

  test('passes the glitch option when it is on', async () => {
    let on = false;
    const { backend, runner } = setup(true, { glitch: () => on });
    on = true;
    await runner.start();
    expect(backend.jumps.every((j) => j.glitch)).toBe(true);
  });

  test('a skip cancels queued cuts and queues them again', async () => {
    const { backend, runner } = setup(true);
    await runner.start();
    await runner.skip(25);
    expect(runner.index).toBe(2);
    expect(backend.jumps.slice(2)).toEqual([{ atReal: 50, toReal: 40, glitch: false }]);
  });

  test('keeps in step with the audio clock, so no drift seek happens', async () => {
    const { clock, backend, runner } = setup(true);
    await runner.start();
    clock.advance(39);
    expect(backend.seeks).toEqual([0]);
  });

  test('drift beyond 0.25 s seeks and queues again', async () => {
    const { clock, backend, runner } = setup(true);
    await runner.start();
    clock.advance(2);
    backend.offset = 0.4;
    clock.advance(1.2);
    await new Promise((resolve) => setTimeout(resolve, 0)); // the seek is async
    expect(backend.seeks.length).toBe(2);
    expect(backend.jumps.length).toBe(4);
  });
});

test('resync repairs a backend that stopped', async () => {
  const { clock, backend, runner } = setup(true);
  await runner.start();
  clock.advance(4);
  backend.pause(); // an interruption stopped the audio
  clock.advance(6);
  await runner.resync();
  expect(backend.playing).toBe(true);
  expect(backend.seeks[backend.seeks.length - 1]).toBeCloseTo(10, 0);
});

test('an empty schedule is rejected', () => {
  const clock = new FakeClock();
  expect(() => new ClassRunner(new FakeBackend(clock, false), [], { clock })).toThrow();
});

test('two contiguous items never seek', async () => {
  const clock = new FakeClock();
  const backend = new FakeBackend(clock, false);
  const runner = new ClassRunner(backend, [item(0, 0, 5, 10), item(1, 5, 10, 15)], { clock });
  await runner.start();
  clock.advance(10);
  expect(backend.seeks).toEqual([5]);
});
