import type { Program, Segment } from '@grade/schema';

/** Titles are derived at render time. Never store the generated text in `label`. */
export function segmentTitle(program: Program, segment: Segment): string {
  if (segment.label) return segment.label;
  if (segment.kind === 'intro') return 'Intro';
  if (segment.kind === 'outro') return 'Outro';
  const n = program.segments.filter((s) => s.kind === 'section');
  return `Section ${n.findIndex((s) => s.id === segment.id) + 1}`;
}

/** Hint such as "~2": the number of the first section this one sounds like, or null. */
export function similarityHint(program: Program, segment: Segment): string | null {
  if (!segment.similarTo) return null;
  const sections = program.segments.filter((s) => s.kind === 'section');
  const n = sections.findIndex((s) => s.id === segment.similarTo);
  return n < 0 ? null : `~${n + 1}`;
}
