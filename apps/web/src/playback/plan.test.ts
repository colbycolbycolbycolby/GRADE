import { describe, expect, test } from 'vitest';
import { makeAnalysis, makeProgram, track } from '../testing/fixtures';
import { PlanPlayer, PRELOAD_LEAD_SEC, type PlanDeps, type PlanSong } from './plan';
import { FakeBackend, FakeClock } from './testkit';

const SONG_SEC = 120; // makeProgram: four 30 s sections, one clip each

function songs(n: number): PlanSong[] {
  return Array.from({ length: n }, (_, i) => ({
    program: { ...makeProgram(`Song ${i + 1}`), id: `p${i + 1}` },
    analysis: makeAnalysis(),
    track: { ...track, title: `Track ${i + 1}` },
  }));
}

function setup(n = 3, over: Partial<PlanDeps> = {}) {
  const clock = new FakeClock();
  const backends: FakeBackend[] = [];
  const loads: string[] = [];
  const contexts: unknown[] = [];
  const deps: PlanDeps = {
    createBackend: (context) => {
      contexts.push(context);
      const b = new FakeBackend(clock, true);
      backends.push(b);
      return b;
    },
    createContext: () => ({ close: async () => undefined, resume: async () => undefined }) as never,
    audioUrl: (id) => {
      loads.push(id); // the plan asks for the url once for each song that it loads
      return `/audio/${id}`;
    },
    clock,
    ...over,
  };
  const player = new PlanPlayer(songs(n), deps);
  const events: string[] = [];
  const ticks: { at: number; songIndex: number }[] = [];
  player.on('song', (e) => events.push(`song${e.songIndex}${e.loading ? ':loading' : ''}`));
  player.on('tick', (e) => ticks.push({ at: clock.now(), songIndex: e.songIndex }));
  player.on('ended', () => events.push('ended'));
  return { clock, player, backends, loads, events, ticks, contexts };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('PlanPlayer', () => {
  test('a three-song plan advances by itself with a gap under 1 s', async () => {
    const { clock, player, events, ticks } = setup(3);
    await player.start();
    clock.advance(SONG_SEC - 1);
    expect(player.songIndex).toBe(0);
    clock.advance(1.2);
    await flush();
    expect(player.songIndex).toBe(1);
    clock.advance(SONG_SEC);
    await flush();
    expect(player.songIndex).toBe(2);
    clock.advance(SONG_SEC);
    await flush();
    expect(events).toEqual(['song0', 'song1:loading', 'song1', 'song2:loading', 'song2', 'ended']);

    // The first tick of each later song comes within 1 s of the end of the one before.
    const firstTick = (i: number) => ticks.find((t) => t.songIndex === i)!.at;
    const lastTick = (i: number) => ticks.filter((t) => t.songIndex === i).at(-1)!.at;
    expect(firstTick(1) - lastTick(0)).toBeLessThanOrEqual(1);
    expect(firstTick(2) - lastTick(1)).toBeLessThanOrEqual(1);
  });

  test('the next song loads before the current one ends, not at the start', async () => {
    const { clock, player, loads } = setup(3);
    await player.start();
    expect(loads).toHaveLength(1);
    clock.advance(SONG_SEC - PRELOAD_LEAD_SEC - 1);
    expect(loads).toHaveLength(1);
    clock.advance(2);
    expect(loads).toHaveLength(2);
  });

  test('all songs share one audio context, and a song that finished is released', async () => {
    const { clock, player, contexts, backends } = setup(2);
    await player.start();
    clock.advance(SONG_SEC + 0.2);
    await flush();
    expect(contexts).toHaveLength(2);
    expect(contexts[0]).toBeDefined();
    expect(contexts[0]).toBe(contexts[1]);
    expect(backends[0]!.playing).toBe(false);
    expect(backends[1]!.playing).toBe(true);
  });

  test('nextSong skips to the next song, and on the last song it ends the class', async () => {
    const { clock, player, events } = setup(2);
    await player.start();
    clock.advance(10);
    await player.nextSong();
    expect(player.songIndex).toBe(1);
    expect(player.isPlaying).toBe(true);
    await player.nextSong();
    expect(events.at(-1)).toBe('ended');
    expect(player.isPlaying).toBe(false);
  });

  test('pause, resume and skip act on the current song', async () => {
    const { clock, player } = setup(2);
    await player.start();
    clock.advance(20);
    player.pause();
    expect(player.isPlaying).toBe(false);
    clock.advance(50);
    await player.skip(10);
    await player.resume();
    expect(player.isPlaying).toBe(true);
    clock.advance(SONG_SEC - 30 - 1);
    expect(player.songIndex).toBe(0);
  });

  test('a song that fails to load reports an error and the class stops there', async () => {
    const clock = new FakeClock();
    const errors: string[] = [];
    let made = 0;
    const player = new PlanPlayer(songs(2), {
      clock,
      audioUrl: () => '/x',
      createBackend: () => {
        const b = new FakeBackend(clock, true);
        if (++made === 2)
          b.load = async () => Promise.reject(new Error('audio request failed: 404'));
        return b;
      },
    });
    player.on('error', (e) => errors.push(e.message));
    await player.start();
    clock.advance(SONG_SEC + 1);
    await flush();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Track 2.*404/);
    expect(player.songIndex).toBe(0);
    expect(player.isPlaying).toBe(false);
  });

  test('when the audio ends early, it reports and seeks back to the class position', async () => {
    const clock = new FakeClock();
    const errors: string[] = [];
    const backend = new FakeBackend(clock, true);
    const player = new PlanPlayer(songs(1), {
      clock,
      audioUrl: () => '/x',
      createBackend: () => backend,
    });
    player.on('error', (e) => errors.push(e.message));
    await player.start();
    clock.advance(30);
    const seeksBefore = backend.seeks.length;
    backend.emitEnded();
    await flush();
    expect(errors).toHaveLength(1);
    expect(backend.seeks.length).toBe(seeksBefore + 1);
    expect(player.isPlaying).toBe(true);
  });

  test('the end of the audio at the end of the class is not an error', async () => {
    const clock = new FakeClock();
    const errors: string[] = [];
    const backend = new FakeBackend(clock, true);
    const player = new PlanPlayer(songs(1), {
      clock,
      audioUrl: () => '/x',
      createBackend: () => backend,
    });
    player.on('error', (e) => errors.push(e.message));
    await player.start();
    clock.advance(SONG_SEC - 0.2);
    backend.emitEnded();
    await flush();
    expect(errors).toEqual([]);
  });

  test('dispose stops the class and closes the shared context', async () => {
    let closed = false;
    const { player, clock } = setup(2, {
      createContext: () =>
        ({ resume: async () => undefined, close: async () => void (closed = true) }) as never,
    });
    await player.start();
    player.dispose();
    await flush();
    expect(closed).toBe(true);
    clock.advance(500); // timers are gone: nothing throws
  });

  test('an empty plan is refused', () => {
    expect(
      () => new PlanPlayer([], { audioUrl: () => '', createBackend: () => null as never }),
    ).toThrow();
  });
});
