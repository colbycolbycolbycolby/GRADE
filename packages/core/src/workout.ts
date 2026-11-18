import type { Position, Program, Segment, WorkoutFormat } from '@grade/schema';

export interface RecognizedWorkoutFields {
  resistanceZone?: number;
  cadence?: { minRpm: number; maxRpm?: number };
  position?: Position;
}

export const WORKOUT_FORMATS: readonly { value: WorkoutFormat; label: string }[] = [
  { value: 'warmup', label: 'Warm-up' },
  { value: 'endurance', label: 'Endurance' },
  { value: 'hills_climb', label: 'Hills / Climb' },
  { value: 'intervals', label: 'Intervals' },
  { value: 'sprint', label: 'Sprint' },
  { value: 'recovery', label: 'Recovery' },
  { value: 'cooldown', label: 'Cooldown' },
  { value: 'mixed', label: 'Mixed' },
];

export function normalizeTag(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, '_');
}

export function addProgramTag(program: Program, input: string): Program {
  const tag = normalizeTag(input);
  const tags = program.tags ?? [];
  return !tag || tags.includes(tag) ? program : { ...program, tags: [...tags, tag] };
}

export function removeProgramTag(program: Program, tag: string): Program {
  return { ...program, tags: (program.tags ?? []).filter((candidate) => candidate !== tag) };
}

/** Recognizes only explicit, bounded workout shorthand. It never infers exertion. */
export function recognizeWorkoutTitle(title: string | null | undefined): RecognizedWorkoutFields {
  const text = title ?? '';
  const result: RecognizedWorkoutFields = {};
  const zone = text.match(/(?:^|\s)z([1-5])(?:\s|$)/i);
  if (zone) result.resistanceZone = Number(zone[1]);

  const cadence = text.match(/(?:^|\s)(\d{2,3})(?:\s*[-–]\s*(\d{2,3}))?(?:\s*rpm)?(?:\s|$)/i);
  if (cadence) {
    const minRpm = Number(cadence[1]);
    const maxRpm = cadence[2] ? Number(cadence[2]) : undefined;
    if (minRpm >= 1 && minRpm <= 250 && maxRpm !== undefined && maxRpm >= minRpm && maxRpm <= 250) {
      result.cadence = { minRpm, maxRpm };
    } else if (minRpm >= 1 && minRpm <= 250 && maxRpm === undefined) {
      result.cadence = { minRpm };
    }
  }

  const positions = [...text.matchAll(/\b(seated|standing|mixed)\b/gi)].map((match) =>
    match[1]!.toLowerCase(),
  );
  const unique = [...new Set(positions)];
  if (unique.length === 1) result.position = unique[0] as Position;
  return result;
}

export function workoutFields(segment: Segment): RecognizedWorkoutFields {
  const recognized = recognizeWorkoutTitle(segment.label);
  return {
    resistanceZone: segment.resistanceZone ?? recognized.resistanceZone,
    cadence: segment.cadence ?? recognized.cadence,
    position: segment.position ?? recognized.position,
  };
}

export function programWorkoutMetadata(program: Program) {
  return {
    programId: program.id,
    trackId: program.trackId,
    analysisVersion: program.analysisVersion,
    workoutFormat: program.workoutFormat,
    tags: program.tags ?? [],
    segments: program.segments.map((segment) => ({
      segmentId: segment.id,
      title: segment.label,
      start: segment.start,
      end: segment.end,
      duration: segment.end - segment.start,
      exertion: segment.tier,
      ...workoutFields(segment),
    })),
  };
}
