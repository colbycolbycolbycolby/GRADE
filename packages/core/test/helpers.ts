import type { Program, Segment, Tier } from '@grade/schema';
import { defaultClips, type NewId } from '../src/index';

export function counterId(prefix = 'n'): NewId {
  let n = 0;
  return () => `${prefix}${++n}`;
}

/** Builds a valid program. `parts` are [length, tier, kind?]. Ids are s1, s2, ... and c1, c2, ... */
export function makeProgram(parts: [number, Tier, Segment['kind']?][]): Program {
  let t = 0;
  const segments: Segment[] = parts.map(([len, tier, kind], i) => {
    const seg: Segment = {
      id: `s${i + 1}`,
      start: t,
      end: t + len,
      tier,
      label: null,
      kind: kind ?? 'section',
    };
    t += len;
    return seg;
  });
  let c = 0;
  return {
    id: 'p',
    name: 'Test',
    trackId: 'yt:dQw4w9WgXcQ',
    analysisVersion: 1,
    segments,
    clips: defaultClips(segments, () => `c${++c}`),
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

/** Small deterministic random generator. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
