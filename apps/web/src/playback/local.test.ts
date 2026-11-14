import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FADE_SEC, LocalAudioBackend } from './local';

class FakeParam {
  value = 1;
  curves: { at: number; length: number }[] = [];
  points: [number, number][] = [];
  setValueCurveAtTime(_c: Float32Array, at: number, length: number) {
    this.curves.push({ at, length });
  }
  setValueAtTime(v: number, t: number) {
    this.points.push([t, v]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.points.push([t, v]);
  }
}
class FakeGain {
  gain = new FakeParam();
  connect() {}
  disconnect() {}
}
class FakeSource {
  buffer: unknown = null;
  startArgs: number[] = [];
  stopArgs: (number | undefined)[] = [];
  onended: (() => void) | null = null;
  connect() {}
  disconnect() {}
  start(...args: number[]) {
    this.startArgs = args;
  }
  stop(when?: number) {
    this.stopArgs.push(when);
  }
}
class FakeContext {
  currentTime = 0;
  state = 'suspended';
  destination = {};
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  async decodeAudioData() {
    return { duration: 100 };
  }
  async resume() {
    this.state = 'running';
  }
  async suspend() {
    this.state = 'suspended';
  }
  async close() {}
}

let ctx: FakeContext;
let backend: LocalAudioBackend;

beforeEach(async () => {
  vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  ctx = new FakeContext();
  backend = new LocalAudioBackend(() => ctx as unknown as AudioContext);
  await backend.load({ id: 'file:x', url: '/audio' });
  await backend.seek(0); // load starts no source, so a shared context stays quiet
});
afterEach(() => {
  backend.dispose();
  vi.unstubAllGlobals();
});

describe('LocalAudioBackend', () => {
  test('load starts no source, and a shared context stays open on dispose', async () => {
    const shared = new FakeContext();
    const close = vi.spyOn(shared, 'close');
    const other = new LocalAudioBackend(() => shared as unknown as AudioContext, false);
    await other.load({ id: 'file:y', url: '/audio' });
    expect(shared.sources).toHaveLength(0);
    await other.seek(5);
    expect(shared.sources).toHaveLength(1);
    other.dispose();
    expect(close).not.toHaveBeenCalled();
  });

  test('capabilities', () => {
    expect(backend.capabilities).toEqual({
      sampleAccurate: true,
      crossfade: true,
      backgroundPlayback: false,
    });
  });

  test('load needs a url', async () => {
    const other = new LocalAudioBackend(() => new FakeContext() as unknown as AudioContext);
    await expect(other.load({ id: 'yt:x', youtubeId: 'x' })).rejects.toThrow();
  });

  test('position follows the audio clock and clamps to the song', () => {
    expect(ctx.sources[0]!.startArgs).toEqual([0, 0]);
    ctx.currentTime = 12.5;
    expect(backend.position).toBeCloseTo(12.5, 9);
    ctx.currentTime = 500;
    expect(backend.position).toBe(100);
  });

  test('seek stops the old source and starts a new one at the offset', async () => {
    ctx.currentTime = 3;
    await backend.seek(30);
    expect(ctx.sources[0]!.stopArgs).toHaveLength(1);
    expect(ctx.sources[1]!.startArgs).toEqual([3, 30]);
    ctx.currentTime = 5;
    expect(backend.position).toBeCloseTo(32, 9);
  });

  test('scheduleJump crossfades on the audio clock', () => {
    ctx.currentTime = 2;
    backend.scheduleJump(10, 40);
    const [outgoing, incoming] = ctx.sources;
    expect(outgoing!.stopArgs).toEqual([10]);
    expect(incoming!.startArgs[0]).toBeCloseTo(10 - FADE_SEC, 9);
    expect(incoming!.startArgs[1]).toBeCloseTo(40 - FADE_SEC, 9);
    expect(ctx.gains[1]!.gain.curves[0]!.at).toBeCloseTo(10 - FADE_SEC, 9);
    expect(ctx.gains[2]!.gain.value).toBe(0); // the incoming source fades in from silence

    ctx.currentTime = 9.99;
    expect(backend.position).toBeCloseTo(9.99, 9);
    ctx.currentTime = 10.5;
    expect(backend.position).toBeCloseTo(40.5, 9);
  });

  test('jumps chain: the next one starts from where the last landed', () => {
    backend.scheduleJump(10, 40);
    backend.scheduleJump(50, 5); // 10 s after the first cut, in audio time
    expect(ctx.sources[2]!.startArgs[0]).toBeCloseTo(20 - FADE_SEC, 9);
    ctx.currentTime = 20.5;
    expect(backend.position).toBeCloseTo(5.5, 9);
  });

  test('seek cancels queued jumps', async () => {
    backend.scheduleJump(10, 40);
    await backend.seek(1);
    ctx.currentTime = 11;
    expect(backend.position).toBeCloseTo(12, 9);
  });

  test('a cut very close to now still fades with what time is left', () => {
    ctx.currentTime = 9.99;
    backend.scheduleJump(10, 40);
    const curve = ctx.gains[1]!.gain.curves[0]!;
    expect(curve.length).toBeLessThanOrEqual(FADE_SEC);
    expect(curve.at + curve.length).toBeCloseTo(10, 2);
  });

  test('glitch layers six grains from just before the cut', () => {
    ctx.currentTime = 1;
    backend.scheduleJump(10, 40, { glitch: true });
    const grains = ctx.sources.slice(2); // after the song source and the incoming source
    expect(grains).toHaveLength(6);
    const [when, offset, length] = grains[0]!.startArgs as [number, number, number];
    expect(when).toBeCloseTo(10 - 0.35, 9);
    expect(offset).toBeCloseTo(10 - 0.14, 9);
    expect(length).toBeCloseTo(0.14, 9);
  });

  test('no glitch unless asked', () => {
    backend.scheduleJump(10, 40);
    expect(ctx.sources).toHaveLength(2);
  });

  test('onEnded fires at the natural end but not for a stopped source', async () => {
    const ended = vi.fn();
    backend.onEnded(ended);
    backend.scheduleJump(10, 40);
    ctx.sources[0]!.onended?.(); // the outgoing source stops at the cut
    expect(ended).not.toHaveBeenCalled();
    ctx.sources[1]!.onended?.(); // the last source reaches the end of the buffer
    expect(ended).toHaveBeenCalledTimes(1);
  });

  test('position listeners get updates until removed', () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    const off = backend.onPosition((t) => seen.push(t));
    ctx.currentTime = 1;
    vi.advanceTimersByTime(250);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    off();
    const count = seen.length;
    vi.advanceTimersByTime(500);
    expect(seen.length).toBe(count);
    vi.useRealTimers();
  });

  test('play resumes and pause suspends the context', async () => {
    await backend.play();
    expect(ctx.state).toBe('running');
    backend.pause();
    await Promise.resolve();
    expect(ctx.state).toBe('suspended');
  });
});
