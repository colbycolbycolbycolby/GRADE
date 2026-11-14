import { CoreError } from './errors';

/** Immutable undo/redo stack over snapshots. Each function returns a new History. */
export interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
  readonly limit: number;
}

export function createHistory<T>(present: T, limit = 100): History<T> {
  return { past: [], present, future: [], limit };
}

export function commit<T>(h: History<T>, next: T): History<T> {
  if (Object.is(next, h.present)) return h;
  const past = [...h.past, h.present].slice(-h.limit);
  return { ...h, past, present: next, future: [] };
}

export const canUndo = <T>(h: History<T>): boolean => h.past.length > 0;
export const canRedo = <T>(h: History<T>): boolean => h.future.length > 0;

export function undo<T>(h: History<T>): History<T> {
  if (!canUndo(h)) throw new CoreError('nothing_to_undo', 'Nothing to undo');
  const present = h.past[h.past.length - 1]!;
  return { ...h, past: h.past.slice(0, -1), present, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!canRedo(h)) throw new CoreError('nothing_to_undo', 'Nothing to redo');
  const [present, ...future] = h.future as [T, ...T[]];
  return { ...h, past: [...h.past, h.present], present, future };
}
