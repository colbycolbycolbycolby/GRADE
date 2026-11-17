import type { ScheduleItem } from '@grade/core';
import type { Analysis } from '@grade/schema';

export interface EnergyPoint {
  t: number;
  e: number;
}

/** The energy curve laid out in chronological segment order. Analysis time is original-file time. */
export function classEnergy(analysis: Analysis, schedule: ScheduleItem[]): EnergyPoint[] {
  const out: EnergyPoint[] = [];
  for (const item of schedule) {
    for (const p of analysis.energy) {
      const real = p.t - analysis.cropStart;
      if (real < item.realStart) continue;
      if (real >= item.realEnd) break;
      out.push({ t: item.classStart + (real - item.realStart), e: p.e });
    }
  }
  return out;
}

/** Energy at a crop-relative song time, from the nearest earlier point. Result is in 0..1. */
export function energyAt(analysis: Analysis, real: number): number {
  const t = real + analysis.cropStart;
  const points = analysis.energy;
  let lo = 0;
  let hi = points.length - 1;
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid]!.t <= t) lo = mid;
    else hi = mid - 1;
  }
  return Math.min(Math.max(points[lo]!.e, 0), 1);
}
