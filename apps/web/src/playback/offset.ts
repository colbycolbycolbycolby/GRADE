import type { Capabilities, JumpOptions, PlaybackBackend, PlaybackTrack } from './types';

/**
 * Shifts a backend by a fixed number of seconds. Segments and clips use crop-relative time, and
 * the stored audio uses original-file time. Wrapping the backend with `cropStart` converts between
 * them in one place (architecture.md A.5, the "boundaries late by cropStart" bug).
 */
export class OffsetBackend implements PlaybackBackend {
  readonly capabilities: Capabilities;
  readonly scheduleJump?: (atReal: number, toReal: number, opts?: JumpOptions) => void;

  constructor(
    private readonly inner: PlaybackBackend,
    private readonly offset: number,
  ) {
    this.capabilities = inner.capabilities;
    if (inner.scheduleJump) {
      this.scheduleJump = (atReal, toReal, opts) =>
        inner.scheduleJump!(atReal + offset, toReal + offset, opts);
    }
  }

  load(track: PlaybackTrack): Promise<void> {
    return this.inner.load(track);
  }
  play(): Promise<void> {
    return this.inner.play();
  }
  pause(): void {
    this.inner.pause();
  }
  seek(seconds: number): Promise<void> {
    return this.inner.seek(seconds + this.offset);
  }
  get position(): number {
    return Math.max(this.inner.position - this.offset, 0);
  }
  onPosition(cb: (t: number) => void): () => void {
    return this.inner.onPosition((t) => cb(Math.max(t - this.offset, 0)));
  }
  onEnded(cb: () => void): () => void {
    return this.inner.onEnded(cb);
  }
  dispose(): void {
    this.inner.dispose();
  }
}
