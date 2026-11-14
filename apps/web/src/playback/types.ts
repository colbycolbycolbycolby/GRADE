export interface PlaybackTrack {
  id: string;
  url?: string;
  youtubeId?: string;
}

export interface Capabilities {
  sampleAccurate: boolean;
  crossfade: boolean;
  backgroundPlayback: boolean;
}

export interface JumpOptions {
  /** Play the transition glitch before the cut (Appendix A.3). */
  glitch?: boolean;
}

export interface PlaybackBackend {
  load(track: PlaybackTrack): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  /** Moves to a real song time. It also cancels every jump that `scheduleJump` queued. */
  seek(seconds: number): Promise<void>;
  /** Real song time in seconds, best effort. */
  readonly position: number;
  onPosition(cb: (t: number) => void): () => void;
  onEnded(cb: () => void): () => void;
  readonly capabilities: Capabilities;
  dispose(): void;
  /**
   * Only on backends with `capabilities.sampleAccurate`.
   * When playback reaches real time `atReal`, jump to `toReal` on the audio clock.
   * Jumps apply in the order queued: each one starts from the place the last one landed.
   */
  scheduleJump?(atReal: number, toReal: number, opts?: JumpOptions): void;
}
