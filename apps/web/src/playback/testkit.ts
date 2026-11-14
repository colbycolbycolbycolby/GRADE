import type { ScheduleItem } from '@grade/core';
import type { Clock } from './clock';
import type { Capabilities, JumpOptions, PlaybackBackend } from './types';

export class FakeClock implements Clock {
  private t = 0;
  private timers: { every: number; next: number; cb: () => void; live: boolean }[] = [];

  now(): number {
    return this.t;
  }

  every(ms: number, cb: () => void): () => void {
    const timer = { every: ms / 1000, next: this.t + ms / 1000, cb, live: true };
    this.timers.push(timer);
    return () => {
      timer.live = false;
    };
  }

  /** Moves time forward and fires each timer at its due time. */
  advance(seconds: number): void {
    const target = this.t + seconds;
    for (;;) {
      const due = this.timers
        .filter((x) => x.live && x.next <= target + 1e-9)
        .sort((a, b) => a.next - b.next)[0];
      if (!due) break;
      this.t = due.next;
      due.next += due.every;
      due.cb();
    }
    this.t = target;
  }
}

/** A song that plays at real-time speed on the fake clock. */
export class FakeBackend implements PlaybackBackend {
  readonly capabilities: Capabilities;
  readonly seeks: number[] = [];
  readonly jumps: { atReal: number; toReal: number; glitch: boolean }[] = [];
  playing = false;
  /** Added to the reported position, to test drift. */
  offset = 0;
  private real = 0;
  private since = 0;
  private pending: { at: number; to: number }[] = [];

  constructor(
    private readonly clock: FakeClock,
    sampleAccurate: boolean,
  ) {
    this.capabilities = { sampleAccurate, crossfade: sampleAccurate, backgroundPlayback: false };
    if (sampleAccurate) {
      this.scheduleJump = (atReal: number, toReal: number, opts: JumpOptions = {}) => {
        this.jumps.push({ atReal, toReal, glitch: opts.glitch ?? false });
        this.pending.push({ at: atReal, to: toReal });
      };
    }
  }

  scheduleJump?: (atReal: number, toReal: number, opts?: JumpOptions) => void;

  async load(): Promise<void> {}

  async play(): Promise<void> {
    if (this.playing) return;
    this.since = this.clock.now();
    this.playing = true;
  }

  pause(): void {
    this.real = this.rawPosition();
    this.playing = false;
  }

  async seek(seconds: number): Promise<void> {
    this.seeks.push(seconds);
    this.offset = 0; // a seek fixes the drift
    this.real = seconds;
    this.since = this.clock.now();
    this.pending = [];
  }

  get position(): number {
    return this.rawPosition() + this.offset;
  }

  onPosition(): () => void {
    return () => undefined;
  }
  private endedListeners = new Set<() => void>();

  onEnded(cb: () => void): () => void {
    this.endedListeners.add(cb);
    return () => this.endedListeners.delete(cb);
  }

  /** Tells the listeners that the audio reached its end. */
  emitEnded(): void {
    for (const cb of [...this.endedListeners]) cb();
  }
  dispose(): void {}

  private rawPosition(): number {
    if (!this.playing) return this.real;
    let pos = this.real + (this.clock.now() - this.since);
    // Apply queued jumps the way an audio clock would.
    while (this.pending.length > 0 && pos >= this.pending[0]!.at) {
      const jump = this.pending.shift()!;
      pos = jump.to + (pos - jump.at);
      this.real = pos;
      this.since = this.clock.now();
    }
    return pos;
  }
}

export function item(
  index: number,
  classStart: number,
  realStart: number,
  realEnd: number,
  tier: ScheduleItem['tier'] = 'moderate',
): ScheduleItem {
  return {
    clipId: `c${index}`,
    segmentId: `s${index}`,
    tier,
    title: `Block ${index}`,
    realStart,
    realEnd,
    classStart,
    classEnd: classStart + (realEnd - realStart),
  };
}

/**
 * 0-10 and 10-20 are contiguous. 40-50 is a genuine cut. 40-50 again is a genuine cut back.
 * The class lasts 40 s.
 */
export function sampleSchedule(): ScheduleItem[] {
  return [item(0, 0, 0, 10), item(1, 10, 10, 20), item(2, 20, 40, 50), item(3, 30, 40, 50)];
}
