/** Time source for the class runner. Tests replace it with a fake clock. */
export interface Clock {
  /** Seconds. Only differences matter. */
  now(): number;
  every(ms: number, cb: () => void): () => void;
}

export const realClock: Clock = {
  now: () => performance.now() / 1000,
  every(ms, cb) {
    const id = setInterval(cb, ms);
    return () => clearInterval(id);
  },
};
