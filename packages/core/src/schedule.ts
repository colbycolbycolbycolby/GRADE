import type { Program, Tier } from '@grade/schema';
import { EPS, GENUINE_CUT_SEC } from './constants';
import { segmentTitle } from './titles';

export interface ScheduleItem {
  clipId: string;
  segmentId: string;
  tier: Tier;
  title: string;
  realStart: number;
  realEnd: number;
  classStart: number;
  classEnd: number;
}

/** The class timeline is the clips laid end to end. */
export function buildSchedule(program: Program): ScheduleItem[] {
  const items: ScheduleItem[] = [];
  let t = 0;
  for (const clip of program.clips) {
    const seg = program.segments.find((s) => s.id === clip.segmentId);
    if (!seg) continue;
    const len = clip.end - clip.start;
    items.push({
      clipId: clip.id,
      segmentId: seg.id,
      tier: seg.tier,
      title: segmentTitle(program, seg),
      realStart: clip.start,
      realEnd: clip.end,
      classStart: t,
      classEnd: t + len,
    });
    t += len;
  }
  return items;
}

export function classDuration(schedule: ScheduleItem[]): number {
  return schedule.length === 0 ? 0 : schedule[schedule.length - 1]!.classEnd;
}

/** True when playback must jump. Contiguous clips play straight through with no seek. */
export function isGenuineCut(prevRealEnd: number, nextRealStart: number): boolean {
  return Math.abs(nextRealStart - prevRealEnd) > GENUINE_CUT_SEC + EPS;
}

/** Index of the item that plays at class time `t`. Returns the last item at or after the end. */
export function itemIndexAtClassTime(schedule: ScheduleItem[], t: number): number {
  for (let i = 0; i < schedule.length; i++) {
    if (t < schedule[i]!.classEnd) return i;
  }
  return Math.max(0, schedule.length - 1);
}

/** Converts a class time to the real song time that plays then. */
export function classToRealTime(schedule: ScheduleItem[], t: number): number {
  const item = schedule[itemIndexAtClassTime(schedule, t)];
  if (!item) return 0;
  const offset = Math.min(Math.max(t - item.classStart, 0), item.realEnd - item.realStart);
  return item.realStart + offset;
}
