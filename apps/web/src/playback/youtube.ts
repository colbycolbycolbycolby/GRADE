import type { Capabilities, PlaybackBackend, PlaybackTrack } from './types';

/** The part of the YouTube IFrame API that we use. */
export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  destroy(): void;
}

export interface YTPlayerOptions {
  videoId: string;
  playerVars: Record<string, number>;
  events: {
    onReady: () => void;
    onStateChange: (e: { data: number }) => void;
    onError: (e: { data: number }) => void;
  };
}

export interface YTApi {
  Player: new (element: HTMLElement | string, options: YTPlayerOptions) => YTPlayer;
}

const ENDED = 0;
const POLL_MS = 250;
const API_URL = 'https://www.youtube.com/iframe_api';

declare global {
  interface Window {
    YT?: YTApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** Loads the IFrame API script once. */
export function loadYouTubeApi(): Promise<YTApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
      else reject(new Error('YouTube API did not load'));
    };
    const script = document.createElement('script');
    script.src = API_URL;
    script.onerror = () => reject(new Error('YouTube API script failed to load'));
    document.head.append(script);
  });
}

/**
 * Fallback backend. It cannot cut on the audio clock, so every capability is false.
 * The UI must warn the user and disable the glitch and crossfade options.
 */
export class YouTubeEmbedBackend implements PlaybackBackend {
  readonly capabilities: Capabilities = {
    sampleAccurate: false,
    crossfade: false,
    backgroundPlayback: false,
  };

  private player: YTPlayer | null = null;
  private positionListeners = new Set<(t: number) => void>();
  private endedListeners = new Set<() => void>();
  private poll: ReturnType<typeof setInterval> | null = null;
  private readonly container: HTMLElement | string;
  private readonly ownedContainer: HTMLElement | null;

  constructor(
    container?: HTMLElement | string,
    private readonly loadApi: () => Promise<YTApi> = loadYouTubeApi,
  ) {
    if (container === undefined) {
      const element = document.createElement('div');
      element.setAttribute('aria-hidden', 'true');
      element.style.cssText =
        'position:fixed;width:1px;height:1px;left:-10000px;top:-10000px;overflow:hidden';
      document.body.append(element);
      this.container = element;
      this.ownedContainer = element;
    } else {
      this.container = container;
      this.ownedContainer = null;
    }
  }

  async load(track: PlaybackTrack): Promise<void> {
    if (!track.youtubeId) throw new Error('YouTubeEmbedBackend needs a youtubeId');
    const api = await this.loadApi();
    this.player?.destroy();
    this.player = await new Promise<YTPlayer>((resolve, reject) => {
      const created: YTPlayer = new api.Player(this.container, {
        videoId: track.youtubeId!,
        playerVars: { playsinline: 1, controls: 0, rel: 0 },
        events: {
          onReady: () => resolve(created),
          onStateChange: (e) => {
            if (e.data === ENDED) for (const cb of [...this.endedListeners]) cb();
          },
          onError: (e) => reject(new Error(`YouTube player error ${e.data}`)),
        },
      });
    });
  }

  async play(): Promise<void> {
    this.player?.playVideo();
  }

  pause(): void {
    this.player?.pauseVideo();
  }

  async seek(seconds: number): Promise<void> {
    this.player?.seekTo(Math.max(seconds, 0), true);
  }

  get position(): number {
    return this.player?.getCurrentTime() ?? 0;
  }

  onPosition(cb: (t: number) => void): () => void {
    this.positionListeners.add(cb);
    this.poll ??= setInterval(() => {
      const t = this.position;
      for (const fn of [...this.positionListeners]) fn(t);
    }, POLL_MS);
    return () => {
      this.positionListeners.delete(cb);
      if (this.positionListeners.size === 0 && this.poll !== null) {
        clearInterval(this.poll);
        this.poll = null;
      }
    };
  }

  onEnded(cb: () => void): () => void {
    this.endedListeners.add(cb);
    return () => this.endedListeners.delete(cb);
  }

  dispose(): void {
    if (this.poll !== null) clearInterval(this.poll);
    this.poll = null;
    this.positionListeners.clear();
    this.endedListeners.clear();
    this.player?.destroy();
    this.player = null;
    this.ownedContainer?.remove();
  }
}
