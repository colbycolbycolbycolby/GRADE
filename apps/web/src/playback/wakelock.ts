export interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener?(type: 'release', cb: () => void): void;
}

export interface WakeLockApi {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

/**
 * Keeps the screen awake during class. The browser drops the lock when the page is hidden,
 * so this asks again when the page becomes visible and the class still needs the lock.
 */
export class ScreenWakeLock {
  private sentinel: WakeLockSentinelLike | null = null;
  private wanted = false;
  private readonly onVisible = () => {
    if (this.wanted && this.doc.visibilityState === 'visible' && !this.sentinel) {
      void this.request();
    }
  };

  constructor(
    private readonly api: WakeLockApi | undefined = typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock,
    private readonly doc: Document = document,
  ) {}

  get supported(): boolean {
    return this.api !== undefined;
  }

  get held(): boolean {
    return this.sentinel !== null;
  }

  /** Call this in the gesture that starts class. Returns true when the screen lock is held. */
  async acquire(): Promise<boolean> {
    if (!this.wanted) this.doc.addEventListener('visibilitychange', this.onVisible);
    this.wanted = true;
    return this.request();
  }

  async release(): Promise<void> {
    this.wanted = false;
    this.doc.removeEventListener('visibilitychange', this.onVisible);
    const sentinel = this.sentinel;
    this.sentinel = null;
    try {
      await sentinel?.release();
    } catch {
      // The browser may have released it already.
    }
  }

  private async request(): Promise<boolean> {
    if (!this.api) return false;
    try {
      const sentinel = await this.api.request('screen');
      if (!this.wanted) {
        // The class ended while the request was open.
        await sentinel.release();
        return false;
      }
      this.sentinel = sentinel;
      sentinel.addEventListener?.('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      });
      return true;
    } catch {
      // The browser refuses when the page is hidden or the battery is low.
      return false;
    }
  }
}
