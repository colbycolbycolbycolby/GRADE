import { equalPowerCurves, glitchPlan, GLITCH_ATTACK_SEC, GLITCH_GRAIN_SEC } from './glitch';
import type { Capabilities, JumpOptions, PlaybackBackend, PlaybackTrack } from './types';

/** Length of the equal-power crossfade at a cut. */
export const FADE_SEC = 0.02;
/** A jump that is already late is moved this far ahead of the audio clock. */
const MIN_LEAD_SEC = 0.005;
const POLL_MS = 100;

interface Anchor {
  /** Audio clock time. */
  ctx: number;
  /** Real song time that plays at `ctx`. */
  real: number;
}

interface Live {
  src: AudioBufferSourceNode;
  gain: GainNode;
  /** True when we stopped it, or planned to. Its `ended` event is then not the end of the song. */
  stopped: boolean;
}

/**
 * Plays the decoded song through Web Audio. Cuts are scheduled on `AudioContext.currentTime`,
 * so they do not depend on timers. Each cut is an equal-power crossfade.
 */
export class LocalAudioBackend implements PlaybackBackend {
  readonly capabilities: Capabilities = {
    sampleAccurate: true,
    crossfade: true,
    // Not verified on a real phone. See docs/decisions.md.
    backgroundPlayback: false,
  };

  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly curves = equalPowerCurves();
  private buffer: AudioBuffer | null = null;
  private anchor: Anchor = { ctx: 0, real: 0 };
  private jumps: { at: number; to: number }[] = [];
  private sources: Live[] = [];
  private positionListeners = new Set<(t: number) => void>();
  private endedListeners = new Set<() => void>();
  private poll: ReturnType<typeof setInterval> | null = null;

  /**
   * `context` lets several songs share one `AudioContext`. A class plan does this, so the context
   * that the Start gesture resumed also plays the later songs. The backend then does not close it.
   */
  constructor(
    createContext: () => AudioContext = () => new AudioContext(),
    private readonly ownsContext = true,
  ) {
    this.ctx = createContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
  }

  async load(track: PlaybackTrack): Promise<void> {
    if (!track.url) throw new Error('LocalAudioBackend needs a track url');
    const res = await fetch(track.url);
    if (!res.ok) throw new Error(`audio request failed: ${res.status}`);
    this.buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
    // No source starts here: the context may be shared and running. Call `seek` before `play`.
    this.stopAll();
    this.anchor = { ctx: this.ctx.currentTime, real: 0 };
    this.jumps = [];
  }

  async play(): Promise<void> {
    await this.ctx.resume();
  }

  pause(): void {
    void this.ctx.suspend().catch(() => undefined);
  }

  async seek(seconds: number): Promise<void> {
    this.rebuild(seconds);
  }

  get position(): number {
    const now = this.ctx.currentTime;
    this.applyDueJumps(now);
    const raw = this.anchor.real + (now - this.anchor.ctx);
    return Math.min(Math.max(raw, 0), this.buffer?.duration ?? 0);
  }

  onPosition(cb: (t: number) => void): () => void {
    this.positionListeners.add(cb);
    this.startPolling();
    return () => {
      this.positionListeners.delete(cb);
      this.stopPollingIfIdle();
    };
  }

  onEnded(cb: () => void): () => void {
    this.endedListeners.add(cb);
    return () => this.endedListeners.delete(cb);
  }

  scheduleJump(atReal: number, toReal: number, opts: JumpOptions = {}): void {
    const buffer = this.buffer;
    const outgoing = this.sources[this.sources.length - 1];
    if (!buffer || !outgoing) return;
    const now = this.ctx.currentTime;
    const last = this.jumps[this.jumps.length - 1];
    const from: Anchor = last ? { ctx: last.at, real: last.to } : this.anchor;
    const at = Math.max(from.ctx + (atReal - from.real), now + MIN_LEAD_SEC);
    const target = Math.min(Math.max(toReal, 0), buffer.duration);
    const fade = Math.max(0, Math.min(FADE_SEC, at - now, target));

    outgoing.stopped = true;
    if (fade > 0) outgoing.gain.gain.setValueCurveAtTime(this.curves.fadeOut, at - fade, fade);
    outgoing.src.stop(at);

    const incoming = this.makeSource(at - fade, target - fade, fade > 0);
    if (fade > 0) incoming.gain.gain.setValueCurveAtTime(this.curves.fadeIn, at - fade, fade);
    this.jumps.push({ at, to: target });
    if (opts.glitch) this.playGlitch(buffer, atReal, at, now);
  }

  dispose(): void {
    this.stopAll();
    if (this.poll !== null) clearInterval(this.poll);
    this.poll = null;
    this.positionListeners.clear();
    this.endedListeners.clear();
    if (this.ownsContext) void this.ctx.close().catch(() => undefined);
  }

  /** Stops everything and plays from `real`. This cancels queued jumps. */
  private rebuild(real: number): void {
    if (!this.buffer) return;
    this.stopAll();
    const target = Math.min(Math.max(real, 0), this.buffer.duration);
    const now = this.ctx.currentTime;
    this.makeSource(now, target, false);
    this.anchor = { ctx: now, real: target };
    this.jumps = [];
  }

  private makeSource(when: number, offset: number, silent: boolean): Live {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = silent ? 0 : 1;
    src.connect(gain);
    gain.connect(this.master);
    const live: Live = { src, gain, stopped: false };
    src.onended = () => this.handleEnded(live);
    src.start(when, Math.max(offset, 0));
    this.sources.push(live);
    return live;
  }

  private handleEnded(live: Live): void {
    this.sources = this.sources.filter((s) => s !== live);
    live.src.disconnect();
    live.gain.disconnect();
    if (!live.stopped && this.sources.length === 0) {
      for (const cb of [...this.endedListeners]) cb();
    }
  }

  private stopAll(): void {
    for (const live of this.sources) {
      live.stopped = true;
      try {
        live.src.stop();
      } catch {
        // The source may not have started yet. It is dropped anyway.
      }
      live.src.disconnect();
      live.gain.disconnect();
    }
    this.sources = [];
  }

  private applyDueJumps(now: number): void {
    while (this.jumps.length > 0 && now >= this.jumps[0]!.at) {
      const jump = this.jumps.shift()!;
      this.anchor = { ctx: jump.at, real: jump.to };
    }
  }

  /** Grains of the audio just before the cut, repeated and layered over the music. */
  private playGlitch(buffer: AudioBuffer, cutReal: number, cutAt: number, now: number): void {
    const grainStart = Math.max(cutReal - GLITCH_GRAIN_SEC, 0);
    const length = Math.min(GLITCH_GRAIN_SEC, cutReal - grainStart);
    if (length <= 0) return;
    for (const grain of glitchPlan(cutAt, now)) {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, grain.when);
      gain.gain.linearRampToValueAtTime(grain.peak, grain.when + GLITCH_ATTACK_SEC);
      gain.gain.linearRampToValueAtTime(0, grain.when + length);
      src.connect(gain);
      gain.connect(this.master);
      src.start(grain.when, grainStart, length);
      src.onended = () => {
        src.disconnect();
        gain.disconnect();
      };
    }
  }

  private startPolling(): void {
    if (this.poll !== null) return;
    this.poll = setInterval(() => {
      const t = this.position;
      for (const cb of [...this.positionListeners]) cb(t);
    }, POLL_MS);
  }

  private stopPollingIfIdle(): void {
    if (this.poll !== null && this.positionListeners.size === 0) {
      clearInterval(this.poll);
      this.poll = null;
    }
  }
}
