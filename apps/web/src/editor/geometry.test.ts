import { expect, test } from 'vitest';
import {
  clampBoundary,
  formatTime,
  insertionIndex,
  segmentIndexAt,
  timeToX,
  trimEdge,
  xToTime,
} from './geometry';

const segs = [
  { start: 0, end: 30 },
  { start: 30, end: 60 },
  { start: 60, end: 120 },
];

test('time and x convert both ways and clamp', () => {
  expect(timeToX(60, 120, 600)).toBe(300);
  expect(xToTime(300, 120, 600)).toBe(60);
  expect(xToTime(-10, 120, 600)).toBe(0);
  expect(xToTime(9999, 120, 600)).toBe(120);
  expect(timeToX(5, 0, 600)).toBe(0);
  expect(xToTime(5, 120, 0)).toBe(0);
});

test('segmentIndexAt picks the holder, and the last one at the end', () => {
  expect(segmentIndexAt(segs, 0)).toBe(0);
  expect(segmentIndexAt(segs, 30)).toBe(1);
  expect(segmentIndexAt(segs, 119.9)).toBe(2);
  expect(segmentIndexAt(segs, 120)).toBe(2);
});

test('clampBoundary keeps both neighbours at the minimum length', () => {
  expect(clampBoundary(segs, 0, 1, 2)).toBe(2);
  expect(clampBoundary(segs, 0, 59, 2)).toBe(58);
  expect(clampBoundary(segs, 1, 200, 2)).toBe(118);
  expect(clampBoundary(segs, 0, 15, 2)).toBe(15);
});

test('insertionIndex uses the middle of each tile', () => {
  const rects = [
    { left: 0, width: 100 },
    { left: 100, width: 100 },
  ];
  expect(insertionIndex(rects, 10)).toBe(0);
  expect(insertionIndex(rects, 60)).toBe(1);
  expect(insertionIndex(rects, 160)).toBe(2);
  expect(insertionIndex([], 5)).toBe(0);
});

test('trimEdge stays inside the segment and above the minimum length', () => {
  const clip = { start: 10, end: 20 };
  const seg = { start: 0, end: 30 };
  expect(trimEdge(clip, seg, 'start', 3, 1)).toEqual({ start: 13, end: 20 });
  expect(trimEdge(clip, seg, 'start', -50, 1)).toEqual({ start: 0, end: 20 });
  expect(trimEdge(clip, seg, 'start', 50, 1)).toEqual({ start: 19, end: 20 });
  expect(trimEdge(clip, seg, 'end', 50, 1)).toEqual({ start: 10, end: 30 });
  expect(trimEdge(clip, seg, 'end', -50, 1)).toEqual({ start: 10, end: 11 });
});

test('formatTime', () => {
  expect(formatTime(0)).toBe('0:00');
  expect(formatTime(65.4)).toBe('1:05');
  expect(formatTime(-3)).toBe('0:00');
});
