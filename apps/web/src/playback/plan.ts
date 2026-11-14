import { buildSchedule, classToRealTime, type ScheduleItem } from '@grade/core';
import type { Analysis, Program, Track } from '@grade/schema';
import { realClock, type Clock } from './clock';
import { OffsetBackend } from './offset';
import { ClassRunner, type RunnerEvents } from './runner';
import type { PlaybackBackend } from './types';

export interface PlanSong {
  program: Program;
  analysis: Analysis;
  track: Track;
}

export interface PlanDeps {
  /** Makes a backend. A plan passes the same `context` to each, so one gesture unlocks them all. */
  createBackend: (context?: AudioContext) => PlaybackBackend;
  /** Makes the shared audio context. Leave it out for backends that need none. */
  createContext?: () => AudioContext;
  audioUrl: (trackId: string) => string;
  clock?: Clock;
  glitch?: () => boolean;
}

export interface PlanEvents {
  /** The current song changed, or its audio started to load. */
  song: { songIndex: number; song: PlanSong; schedule: ScheduleItem[]; loading: boolean };
  block: RunnerEvents['blockChanged'] & { songIndex: number };
  tick: RunnerEvents['tick'] & { songIndex: number; planRemaining: number };
  ended: Record<string, never>;
  error: { message: string };
}

type Listener<K extends keyof PlanEvents> = (payload: PlanEvents[K]) => void;

/** Start loading the next song when this many seconds of the current song remain. */
export const PRELOAD_LEAD_SEC = 90;

interface Slot {
  song: PlanSong;
  schedule: ScheduleItem[];
  backend: OffsetBackend;
  runner: ClassRunner;
  ready: Promise<void>;
  off: (() => void)[];
}

/**
 * Plays several programs in a row. It loads the next song before the current one ends, and it
 * starts the next runner when the current one ends, so the gap is the time of one seek and resume.
 */
export class PlanPlayer {
  private readonly clock: Clock;
  private readonly slots = new Map<number, Slot>();
  private readonly listeners: { [K in keyof PlanEvents]: Set<Listener<K>> } = {
    song: new Set(),
    block: new Set(),
    tick: new Set(),
    ended: new Set(),
    error: new Set(),
  };
  private context: AudioContext | undefined;
  private readonly lengths: number[];
  private current = 0;
  private active = false;
  private moving = false;
  private disposed = false;

  constructor(
    private readonly songs: PlanSong[],
    private readonly deps: PlanDeps,
  ) {
    if (songs.length === 0) throw new Error('a class plan needs at least one song');
    this.clock = deps.clock ?? realClock;
    this.lengths = songs.map((s) => {
      const schedule = buildSchedule(s.program);
      return schedule[schedule.length - 1]?.classEnd ?? 0;
    });
  }

  get songIndex(): number {
    return this.current;
  }
  get songCount(): number {
    return this.songs.length;
  }
  get isPlaying(): boolean {
    return this.active && (this.slots.get(this.current)?.runner.isPlaying ?? false);
  }
  /** The schedule of song `i`. */
  scheduleOf(i: number): ScheduleItem[] {
    return this.slot(i).schedule;
  }

  on<K extends keyof PlanEvents>(event: K, cb: Listener<K>): () => void {
    this.listeners[event].add(cb);
    return () => this.listeners[event].delete(cb);
  }

  /** Loads the first song. Call it when the screen opens, before the user taps Start. */
  async prepare(): Promise<void> {
    await this.slot(this.current).ready;
  }

  /** Call this inside the tap that starts class. */
  async start(): Promise<void> {
    this.active = true;
    // Resume the shared context now, in the tap, before any await. Some browsers need this.
    this.slot(this.current);
    void this.context?.resume().catch(() => undefined);
    await this.prepare();
    this.emitSong(this.current, false);
    await this.slot(this.current).runner.start();
  }

  async resume(): Promise<void> {
    await this.slots.get(this.current)?.runner.resume();
  }

  pause(): void {
    this.slots.get(this.current)?.runner.pause();
  }

  /** Call this when the page returns to the foreground. See `attachLifecycle`. */
  async resync(): Promise<void> {
    await this.slots.get(this.current)?.runner.resync();
  }

  /** Moves by `delta` seconds in the current song. It does not cross to another song. */
  async skip(delta: number): Promise<void> {
    await this.slots.get(this.current)?.runner.skip(delta);
  }

  async seekClass(classTime: number): Promise<void> {
    await this.slots.get(this.current)?.runner.seekClass(classTime);
  }

  /** Jumps to the start of the next song. On the last song it ends the class. */
  async nextSong(): Promise<void> {
    await this.advance();
  }

  stop(): void {
    this.active = false;
    for (const slot of this.slots.values()) slot.runner.stop();
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
    for (const i of [...this.slots.keys()]) this.drop(i);
    for (const set of Object.values(this.listeners)) set.clear();
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = undefined;
  }

  private slot(i: number): Slot {
    const known = this.slots.get(i);
    if (known) return known;
    const song = this.songs[i]!;
    const schedule = buildSchedule(song.program);
    const backend = new OffsetBackend(
      this.deps.createBackend(this.sharedContext()),
      song.analysis.cropStart,
    );
    const runner = new ClassRunner(backend, schedule, {
      clock: this.clock,
      glitch: this.deps.glitch,
    });
    const slot: Slot = { song, schedule, backend, runner, ready: Promise.resolve(), off: [] };
    slot.off.push(
      runner.on('blockChanged', (e) => {
        if (i === this.current) this.emit('block', { ...e, songIndex: i });
      }),
      runner.on('tick', (e) => {
        if (i !== this.current) return;
        this.emit('tick', { ...e, songIndex: i, planRemaining: this.planRemaining(e) });
        if (e.classRemaining <= PRELOAD_LEAD_SEC) this.preload(i + 1);
      }),
      runner.on('classEnded', () => {
        if (i === this.current && this.active) void this.advance();
      }),
      backend.onEnded(() => void this.audioEnded(i)),
    );
    // A load error reaches the user through `error`, and `start` rethrows it.
    // The error text is written for the user, so `start` can show it as it is.
    slot.ready = backend
      .load({ id: song.track.id, url: this.deps.audioUrl(song.track.id) })
      .catch((err: unknown) => {
        const message = loadMessage(song, err);
        if (!this.disposed) this.emit('error', { message });
        throw new Error(message);
      });
    slot.ready.catch(() => undefined);
    this.slots.set(i, slot);
    return slot;
  }

  private sharedContext(): AudioContext | undefined {
    if (!this.deps.createContext) return undefined;
    this.context ??= this.deps.createContext();
    return this.context;
  }

  private preload(i: number): void {
    if (i < this.songs.length && !this.slots.has(i)) void this.slot(i).ready.catch(() => undefined);
  }

  private async advance(): Promise<void> {
    if (this.moving || this.disposed) return;
    this.moving = true;
    try {
      const from = this.current;
      const to = from + 1;
      this.slots.get(from)?.runner.stop();
      if (to >= this.songs.length) {
        this.active = false;
        this.emit('ended', {});
        return;
      }
      const next = this.slot(to);
      this.emitSong(to, true);
      try {
        await next.ready;
      } catch {
        // `slot` already reported the load error. The class stops on this song.
        this.active = false;
        return;
      }
      if (this.disposed || !this.active) return;
      this.current = to;
      this.drop(from);
      this.emitSong(to, false);
      await next.runner.start();
    } finally {
      this.moving = false;
    }
  }

  /** The audio ended before the schedule did. Restart it at the place that class time shows. */
  private async audioEnded(i: number): Promise<void> {
    const slot = this.slots.get(i);
    if (!slot || i !== this.current || !this.active || !slot.runner.isPlaying) return;
    const left = this.lengths[i]! - slot.runner.classTime;
    if (left < 0.5) return; // the class ends now, so the runner handles it
    const real = classToRealTime(slot.schedule, slot.runner.classTime);
    this.emit('error', {
      message: `The audio stopped at ${Math.round(real)} s, before the class part ended.`,
    });
    await slot.runner.seekClass(slot.runner.classTime);
  }

  private planRemaining(e: { classRemaining: number }): number {
    let rest = e.classRemaining;
    for (let i = this.current + 1; i < this.lengths.length; i++) rest += this.lengths[i]!;
    return rest;
  }

  private drop(i: number): void {
    const slot = this.slots.get(i);
    if (!slot) return;
    for (const off of slot.off) off();
    slot.runner.stop();
    slot.backend.dispose();
    this.slots.delete(i);
  }

  private emitSong(i: number, loading: boolean): void {
    const slot = this.slot(i);
    this.emit('song', { songIndex: i, song: slot.song, schedule: slot.schedule, loading });
  }

  private emit<K extends keyof PlanEvents>(event: K, payload: PlanEvents[K]): void {
    for (const cb of [...this.listeners[event]]) cb(payload);
  }
}

function loadMessage(song: PlanSong, err: unknown): string {
  const detail = err instanceof Error ? ` ${err.message}` : '';
  return `The audio for "${song.track.title}" could not load.${detail}`;
}
