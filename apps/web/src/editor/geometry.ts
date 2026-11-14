/** Pure helpers for the waveform and the class strip. Pixels are in the element's own space. */

export interface Segment {
  start: number;
  end: number;
}

export const timeToX = (t: number, duration: number, width: number): number =>
  duration > 0 ? (t / duration) * width : 0;

export const xToTime = (x: number, duration: number, width: number): number =>
  width > 0 ? Math.min(Math.max((x / width) * duration, 0), duration) : 0;

/** Index of the segment that holds time `t`. The last segment holds `duration`. */
export function segmentIndexAt(segments: Segment[], t: number): number {
  const i = segments.findIndex((s) => t >= s.start && t < s.end);
  return i >= 0 ? i : Math.max(segments.length - 1, 0);
}

/** Clamps a dragged boundary so both neighbours keep at least `min` seconds. */
export function clampBoundary(segments: Segment[], index: number, to: number, min: number): number {
  const left = segments[index];
  const right = segments[index + 1];
  if (!left || !right) return to;
  return Math.min(Math.max(to, left.start + min), right.end - min);
}

/**
 * Insertion index for a drag over class-order tiles. `rects` hold each tile's left and width.
 * A pointer in the left half of a tile inserts before it, in the right half after it.
 */
export function insertionIndex(rects: { left: number; width: number }[], x: number): number {
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!;
    if (x < r.left + r.width / 2) return i;
  }
  return rects.length;
}

/** Applies a trim drag of `deltaSec` to one edge of a clip, inside its segment. */
export function trimEdge(
  clip: { start: number; end: number },
  segment: Segment,
  edge: 'start' | 'end',
  deltaSec: number,
  minLen: number,
): { start: number; end: number } {
  if (edge === 'start') {
    const start = Math.min(Math.max(clip.start + deltaSec, segment.start), clip.end - minLen);
    return { start, end: clip.end };
  }
  const end = Math.max(Math.min(clip.end + deltaSec, segment.end), clip.start + minLen);
  return { start: clip.start, end };
}

export function formatTime(sec: number): string {
  const s = Math.max(Math.round(sec), 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
