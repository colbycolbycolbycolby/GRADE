import { classToRealTime, isGenuineCut, type ScheduleItem } from '@grade/core';
import { realClock, type Clock } from './clock';
import type { PlaybackBackend } from './types';

export interface RunnerEvents {
  blockChanged: { index: number; item: ScheduleItem; upcoming: ScheduleItem[] };
  tick: { classTime: number; index: number; blockRemaining: number; classRemaining: number };
  classEnded: Record<string, never>;
}

export interface RunnerOptions {
  clock?: Clock;
  /** Seconds between timer steps. */
  tickSec?: number;
  /** Items ahead of the current one whose cuts are queued on a sample-accurate backend. */
  lookaheadItems?: number;
  /** How many blocks the `upcoming` list holds. */
  upcomingCount?: number;
  /** Read each time a cut is queued, so the user can change it during class. */
  glitch?: () => boolean;
  /** Seconds between checks of the audio position against the schedule. */
  driftCheckSec?: number;
}

type Listener<K extends keyof RunnerEvents> = (payload: RunnerEvents[K]) => void;

const DRIFT_SAMPLE_ACCURATE_SEC = 0.25;
const DRIFT_COARSE_SEC = 1.0;

/**
 * Walks the class schedule on a clock and tells the backend where to play.
 * Class time comes from the clock. The backend position only corrects drift.
 * The UI listens to events. It never reads the backend.
 */
export class ClassRunner {
  private readonly clock: Clock;
  private readonly tickSec: number;
  private readonly lookahead: number;
  private readonly upcomingCount: number;
  private readonly glitch: () => boolean;
  private readonly driftCheckSec: number;
  private readonly total: number;
  private readonly listeners: { [K in keyof RunnerEvents]: Set<Listener<K>> } = {
    blockChanged: new Set(),
    tick: new Set(),
    classEnded: new Set(),
  };
  private stopTimer: (() => void) | null = null;
  private running = false;
  private lastNow = 0;
  private sinceDrift = 0;
  private time = 0;
  private current = 0;
  private nextBoundary = 0;

  constructor(
    private readonly backend: PlaybackBackend,
    private readonly schedule: ScheduleItem[],
    options: RunnerOptions = {},
  ) {
    if (schedule.length === 0) throw new Error('schedule is empty');
    this.clock = options.clock ?? realClock;
    this.tickSec = options.tickSec ?? 0.05;
    this.lookahead = options.lookaheadItems ?? 2;
    this.upcomingCount = options.upcomingCount ?? 3;
    this.glitch = options.glitch ?? (() => false);
    this.driftCheckSec = options.driftCheckSec ?? 1;
    this.total = schedule[schedule.length - 1]!.classEnd;
  }

  get classTime(): number {
    return this.time;
  }
  get index(): number {
    return this.current;
  }
  get isPlaying(): boolean {
    return this.running;
  }

  on<K extends keyof RunnerEvents>(event: K, cb: Listener<K>): () => void {
    this.listeners[event].add(cb);
    return () => this.listeners[event].delete(cb);
  }

  /** Call this inside the user gesture that starts class, so the audio context may resume. */
  async start(): Promise<void> {
    this.time = 0;
    this.current = 0;
    await this.backend.seek(this.schedule[0]!.realStart);
    this.nextBoundary = 0;
    await this.backend.play();
    this.begin();
    this.emitBlock();
    this.queueCuts();
    this.emitTick();
  }

  async resume(): Promise<void> {
    if (this.running || this.time >= this.total) return;
    await this.backend.play();
    this.begin();
  }

  pause(): void {
    if (!this.running) return;
    this.step();
    this.running = false;
    this.backend.pause();
  }

  stop(): void {
    this.running = false;
    this.stopTimer?.();
    this.stopTimer = null;
    this.backend.pause();
  }

  /** Moves by `delta` seconds of class time. */
  async skip(delta: number): Promise<void> {
    if (this.running) this.step();
    await this.seekClass(this.time + delta);
  }

  async seekClass(classTime: number): Promise<void> {
    const t = Math.min(Math.max(classTime, 0), this.total - 0.001);
    const before = this.current;
    this.time = t;
    this.current = this.indexAt(t);
    this.nextBoundary = this.current;
    await this.backend.seek(classToRealTime(this.schedule, t));
    this.lastNow = this.clock.now();
    if (this.current !== before) this.emitBlock();
    this.queueCuts();
    this.emitTick();
  }

  /**
   * Call this when the page returns to the foreground or after an audio interruption.
   * It brings class time up to date, restarts the backend, and fixes drift.
   */
  async resync(): Promise<void> {
    if (!this.running) return;
    this.step();
    if (!this.running) return;
    try {
      await this.backend.play();
    } catch {
      // The browser may need a user gesture. The next tap on the screen will resume.
    }
    await this.fixDrift(true);
  }

  private begin(): void {
    this.running = true;
    this.lastNow = this.clock.now();
    this.sinceDrift = 0;
    this.stopTimer?.();
    this.stopTimer = this.clock.every(this.tickSec * 1000, () => this.step());
  }

  private step(): void {
    if (!this.running) return;
    const now = this.clock.now();
    const dt = Math.max(now - this.lastNow, 0);
    this.lastNow = now;
    this.time += dt;
    this.sinceDrift += dt;

    const crossed = this.advanceBlocks();
    if (this.time >= this.total) {
      this.finish();
      return;
    }
    if (crossed > 0) this.afterCrossing(crossed);
    this.emitTick();
    if (this.sinceDrift >= this.driftCheckSec) void this.fixDrift(false);
  }

  /** Moves `current` forward past every item that has ended. Returns how many it passed. */
  private advanceBlocks(): number {
    let crossed = 0;
    while (
      this.current < this.schedule.length - 1 &&
      this.time >= this.schedule[this.current]!.classEnd
    ) {
      this.current++;
      crossed++;
      this.emitBlock();
    }
    return crossed;
  }

  private afterCrossing(crossed: number): void {
    if (!this.hasQueue()) {
      // No audio-clock cuts: seek here. After a long gap, trust class time over the last cut.
      const item = this.schedule[this.current]!;
      const prev = this.schedule[this.current - 1]!;
      if (crossed > 1) void this.backend.seek(classToRealTime(this.schedule, this.time));
      else if (isGenuineCut(prev.realEnd, item.realStart)) void this.backend.seek(item.realStart);
    }
    this.queueCuts();
  }

  private finish(): void {
    this.time = this.total;
    this.current = this.schedule.length - 1;
    this.running = false;
    this.stopTimer?.();
    this.stopTimer = null;
    this.backend.pause();
    this.emitTick();
    for (const cb of [...this.listeners.classEnded]) cb({});
  }

  private hasQueue(): boolean {
    return (
      this.backend.capabilities.sampleAccurate && typeof this.backend.scheduleJump === 'function'
    );
  }

  /** Queues the cuts for the next few items on a sample-accurate backend. */
  private queueCuts(): void {
    if (!this.hasQueue()) return;
    const last = Math.min(this.current + this.lookahead, this.schedule.length - 2);
    if (this.nextBoundary < this.current) this.nextBoundary = this.current;
    for (; this.nextBoundary <= last; this.nextBoundary++) {
      const from = this.schedule[this.nextBoundary]!;
      const to = this.schedule[this.nextBoundary + 1]!;
      if (isGenuineCut(from.realEnd, to.realStart)) {
        this.backend.scheduleJump!(from.realEnd, to.realStart, { glitch: this.glitch() });
      }
    }
  }

  private async fixDrift(force: boolean): Promise<void> {
    this.sinceDrift = 0;
    if (!this.running) return;
    const limit = this.hasQueue() ? DRIFT_SAMPLE_ACCURATE_SEC : DRIFT_COARSE_SEC;
    const expected = classToRealTime(this.schedule, this.time);
    const drift = Math.abs(this.backend.position - expected);
    if (drift > limit || (force && drift > limit / 2)) {
      this.nextBoundary = this.current;
      await this.backend.seek(expected);
      this.queueCuts();
    }
  }

  private indexAt(t: number): number {
    for (let i = 0; i < this.schedule.length; i++) {
      if (t < this.schedule[i]!.classEnd) return i;
    }
    return this.schedule.length - 1;
  }

  private emitBlock(): void {
    const item = this.schedule[this.current]!;
    const upcoming = this.schedule.slice(this.current + 1, this.current + 1 + this.upcomingCount);
    for (const cb of [...this.listeners.blockChanged]) cb({ index: this.current, item, upcoming });
  }

  private emitTick(): void {
    const item = this.schedule[this.current]!;
    const payload = {
      classTime: this.time,
      index: this.current,
      blockRemaining: Math.max(item.classEnd - this.time, 0),
      classRemaining: Math.max(this.total - this.time, 0),
    };
    for (const cb of [...this.listeners.tick]) cb(payload);
  }
}
