import type { Analysis, Program, Segment, Tier } from '@grade/schema';
import { EPS, MIN_SEGMENT_SEC, TIER_THRESHOLDS } from './constants';
import { defaultNewId, type EditOptions } from './ids';
import { defaultClips } from './repair';

export function tierForEnergy(e: number): Tier {
  const [moderate, hard, allout] = TIER_THRESHOLDS;
  if (e > allout) return 'allout';
  if (e > hard) return 'hard';
  if (e > moderate) return 'moderate';
  return 'easy';
}

function meanEnergy(analysis: Analysis, from: number, to: number): number {
  const pts = analysis.energy.filter((p) => p.t >= from && p.t < to);
  if (pts.length === 0) return 0;
  return pts.reduce((sum, p) => sum + p.e, 0) / pts.length;
}

/**
 * Builds the first program for a track. Analysis times are original-file time. Segment times are
 * relative to cropStart, so every boundary is shifted here.
 */
export function programFromAnalysis(
  analysis: Analysis,
  init: { id?: string; name: string; now: string },
  opts?: EditOptions,
): Program {
  const newId = opts?.newId ?? defaultNewId;
  const { cropStart, cropEnd } = analysis;

  // Keep only boundaries that leave every part at least MIN_SEGMENT_SEC long.
  const cuts: number[] = [];
  let last = cropStart;
  const sorted = [...analysis.boundaries].sort((a, b) => a - b);
  sorted.forEach((b) => {
    if (b - last >= MIN_SEGMENT_SEC - EPS && cropEnd - b >= MIN_SEGMENT_SEC - EPS) {
      cuts.push(b);
      last = b;
    }
  });

  const edges = [cropStart, ...cuts, cropEnd];
  const ids = edges.slice(1).map(() => newId());
  // structure is aligned to the original boundaries, so use it only if nothing was dropped.
  const structure =
    cuts.length === analysis.boundaries.length && analysis.structure?.length === edges.length - 1
      ? analysis.structure
      : undefined;

  const segments: Segment[] = ids.map((id, i) => {
    const start = edges[i]!;
    const end = edges[i + 1]!;
    const seg: Segment = {
      id,
      start: start - cropStart,
      end: end - cropStart,
      tier: tierForEnergy(meanEnergy(analysis, start, end)),
      label: null,
      kind: structure?.[i]?.kind ?? 'section',
    };
    const similar = structure?.[i]?.similarTo;
    if (similar !== undefined && similar < i) seg.similarTo = ids[similar]!;
    return seg;
  });

  return {
    id: init.id ?? newId(),
    name: init.name,
    trackId: analysis.trackId,
    analysisVersion: analysis.version,
    segments,
    clips: defaultClips(segments, newId),
    updatedAt: init.now,
  };
}

export function touch(program: Program, now: string): Program {
  return { ...program, updatedAt: now };
}
