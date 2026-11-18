import { programWorkoutMetadata } from '@grade/core';
import type { Program, WorkoutFormat, WorkoutInterpretation } from '@grade/schema';
import { classSeconds } from './programFiles';

export type WorkoutRole = 'warmup' | 'climb' | 'intervals' | 'sprint' | 'endurance' | 'cooldown';

export interface PlannedProgram {
  programId: string;
  name: string;
  role: WorkoutRole;
  duration: number;
  explanation: string;
}

export interface WorkoutPlanProposal {
  mode: 'deterministic' | 'openai';
  model: string | null;
  requestedMinutes: number | null;
  actualMinutes: number;
  entries: PlannedProgram[];
  shortfalls: string[];
  eligibleCount: number;
  excludedCount: number;
}

interface Request {
  minutes: number | null;
  roles: WorkoutRole[];
  hard: boolean;
  z4: boolean;
  programCount: number | null;
  artistPreferences: string[];
  artistExclusions: string[];
}

interface Profile {
  program: Program;
  duration: number;
  formats: Set<string>;
  z4Ratio: number;
  hardRatio: number;
  standingRatio: number;
  cadenceMax: number;
  varied: boolean;
}

const FORMAT_ROLE: Partial<Record<WorkoutFormat, WorkoutRole>> = {
  warmup: 'warmup',
  hills_climb: 'climb',
  intervals: 'intervals',
  sprint: 'sprint',
  endurance: 'endurance',
  cooldown: 'cooldown',
};

export function isInstructorProgram(program: Program): boolean {
  if (/\bai\s+draft\b/i.test(program.name)) return false;
  const metadata = programWorkoutMetadata(program);
  return Boolean(
    program.workoutFormat ||
    program.tags?.length ||
    metadata.segments.some(
      (segment) =>
        segment.title?.trim() || segment.resistanceZone || segment.cadence || segment.position,
    ),
  );
}

export function parseWorkoutRequest(text: string): Request {
  const lower = text.toLowerCase();
  const duration = lower.match(/\b(\d+(?:\.\d+)?)\s*[- ]?\s*(?:minute|min)\b/);
  const roles: WorkoutRole[] = [];
  const add = (role: WorkoutRole, count = 1) => {
    for (let index = 0; index < count; index += 1) roles.push(role);
  };
  const countBefore = (words: string): number => {
    const match = lower.match(new RegExp(`\\b(\\d+|one|two|three|four|five)\\s+(?:${words})\\b`));
    return match
      ? ({ one: 1, two: 2, three: 3, four: 4, five: 5 }[match[1]!] ?? Number(match[1]))
      : 1;
  };
  if (/\bwarm[ -]?ups?\b/.test(lower)) add('warmup', countBefore('warm[ -]?ups?'));
  if (/\b(?:climbs?|hills?)\b/.test(lower)) add('climb', countBefore('climbs?|hills?'));
  if (/\bintervals?\b/.test(lower)) add('intervals', countBefore('intervals?'));
  if (/\bsprints?\b/.test(lower)) add('sprint', countBefore('sprints?'));
  if (/\bendurance\b/.test(lower)) add('endurance');
  if (/\bcool[ -]?downs?\b/.test(lower)) add('cooldown', countBefore('cool[ -]?downs?'));
  return {
    minutes: duration ? Number(duration[1]) : null,
    roles,
    hard: /\b(?:hard|intense|high intensity)\b/.test(lower),
    z4: /\bz\s*4\b/.test(lower),
    programCount: Number(lower.match(/\b(\d+)\s+(?:programs?|songs?)\b/)?.[1]) || null,
    artistPreferences: [],
    artistExclusions: [],
  };
}

export function deterministicWorkoutInterpretation(text: string): WorkoutInterpretation {
  const request = parseWorkoutRequest(text);
  return {
    mode: 'deterministic',
    model: null,
    durationMinutes: request.minutes,
    sequence: request.roles,
    intensity: request.hard ? 'hard' : null,
    resistanceZones: request.z4 ? [4] : [],
    programCount: request.programCount,
    artistPreferences: [],
    artistExclusions: [],
  };
}

function profile(program: Program): Profile {
  const metadata = programWorkoutMetadata(program);
  const duration = classSeconds(program);
  let z4 = 0;
  let hard = 0;
  let standing = 0;
  let cadenceMax = 0;
  const formats = new Set<string>([program.workoutFormat ?? '', ...(program.tags ?? [])]);
  for (const segment of metadata.segments) {
    const text = (segment.title ?? '').toLowerCase();
    if (/\b(?:warm[ -]?up|climb|hill|interval|sprint|endurance|cool[ -]?down)\b/.test(text)) {
      for (const token of text.match(
        /warm[ -]?up|climb|hill|interval|sprint|endurance|cool[ -]?down/g,
      ) ?? []) {
        formats.add(
          token
            .replace('hill', 'climb')
            .replace(/warm[ -]?up/, 'warmup')
            .replace(/cool[ -]?down/, 'cooldown'),
        );
      }
    }
    if (segment.resistanceZone === 4 || /\bz\s*4\b/.test(text)) z4 += segment.duration;
    if (segment.exertion === 'hard' || segment.exertion === 'allout') hard += segment.duration;
    if (segment.position === 'standing') standing += segment.duration;
    cadenceMax = Math.max(cadenceMax, segment.cadence?.maxRpm ?? segment.cadence?.minRpm ?? 0);
  }
  if (program.workoutFormat && FORMAT_ROLE[program.workoutFormat])
    formats.add(FORMAT_ROLE[program.workoutFormat]!);
  return {
    program,
    duration,
    formats,
    z4Ratio: duration ? z4 / duration : 0,
    hardRatio: duration ? hard / duration : 0,
    standingRatio: duration ? standing / duration : 0,
    cadenceMax,
    varied: new Set(metadata.segments.map((segment) => segment.exertion)).size >= 3,
  };
}

function affinity(item: Profile, role: WorkoutRole, request: Request): number {
  let score = item.formats.has(role) ? 10 : 0;
  if (role === 'climb')
    score += item.standingRatio * 4 + item.z4Ratio * 3 - Math.max(0, item.cadenceMax - 90) / 25;
  if (role === 'sprint') score += item.cadenceMax / 30 + item.hardRatio * 3;
  if (role === 'intervals') score += (item.varied ? 4 : 0) + item.hardRatio * 2;
  if (role === 'endurance') score += (1 - Math.abs(item.hardRatio - 0.45)) * 3;
  if (role === 'warmup') score += (1 - item.hardRatio) * 3;
  if (role === 'cooldown') score += (1 - item.hardRatio) * 3;
  if (request.z4) score += item.z4Ratio * 8;
  if (request.hard) score += item.hardRatio * 4;
  return score;
}

function sequenceRoles(requested: WorkoutRole[], count: number): WorkoutRole[] {
  const roles = [...requested];
  while (roles.length < count)
    roles.push(
      requested.includes('endurance') ? 'endurance' : roles.length % 2 ? 'intervals' : 'climb',
    );
  const ordered: WorkoutRole[] = [];
  const take = (role: WorkoutRole) => {
    const index = roles.indexOf(role);
    if (index >= 0) ordered.push(...roles.splice(index, 1));
  };
  take('warmup');
  const cooldowns = roles.filter((role) => role === 'cooldown');
  for (const role of roles.filter((role) => role !== 'cooldown')) ordered.push(role);
  ordered.push(...cooldowns);
  return ordered.slice(0, count);
}

export function planWorkout(
  programs: Program[],
  text: string,
  interpretation: WorkoutInterpretation = deterministicWorkoutInterpretation(text),
): WorkoutPlanProposal {
  const local = parseWorkoutRequest(text);
  const request: Request = {
    minutes: interpretation.durationMinutes,
    roles: interpretation.sequence,
    hard: interpretation.intensity === 'hard',
    z4: interpretation.resistanceZones.includes(4),
    programCount: interpretation.programCount,
    artistPreferences: interpretation.artistPreferences,
    artistExclusions: interpretation.artistExclusions,
  };
  // The model is additive only: explicit constraints recognized locally cannot be lost.
  if (request.minutes === null) request.minutes = local.minutes;
  if (!request.roles.length) request.roles = local.roles;
  request.hard ||= local.hard;
  request.z4 ||= local.z4;
  request.programCount ??= local.programCount;
  const excludedArtists = request.artistExclusions.map((artist) => artist.toLowerCase());
  const eligible = programs
    .filter(isInstructorProgram)
    .filter(
      (program) => !excludedArtists.some((artist) => program.name.toLowerCase().includes(artist)),
    )
    .map(profile);
  const shortfalls: string[] = [];
  if (!eligible.length) {
    return {
      mode: 'deterministic',
      model: null,
      requestedMinutes: request.minutes,
      actualMinutes: 0,
      entries: [],
      shortfalls: ['No instructor-authored Programs with workout instructions are available.'],
      eligibleCount: 0,
      excludedCount: programs.length,
    };
  }
  const average = eligible.reduce((sum, item) => sum + item.duration, 0) / eligible.length;
  const requestedCount = Math.max(
    request.roles.length,
    request.programCount ??
      (request.minutes
        ? Math.max(1, Math.round((request.minutes * 60) / average))
        : Math.min(eligible.length, 6)),
  );
  const count = Math.min(eligible.length, requestedCount);
  const roles = sequenceRoles(request.roles.length ? request.roles : ['endurance'], count);
  const available = [...eligible];
  const chosen: { item: Profile; role: WorkoutRole; score: number }[] = [];
  for (const role of roles) {
    const targetRemaining = request.minutes
      ? request.minutes * 60 - chosen.reduce((sum, entry) => sum + entry.item.duration, 0)
      : average;
    available.sort((a, b) => {
      const preference = (item: Profile) =>
        request.artistPreferences.some((artist) =>
          item.program.name.toLowerCase().includes(artist.toLowerCase()),
        )
          ? 5
          : 0;
      const aScore =
        affinity(a, role, request) -
        Math.abs(a.duration - targetRemaining / Math.max(1, roles.length - chosen.length)) / 180 +
        preference(a);
      const bScore =
        affinity(b, role, request) -
        Math.abs(b.duration - targetRemaining / Math.max(1, roles.length - chosen.length)) / 180 +
        preference(b);
      return bScore - aScore || a.program.id.localeCompare(b.program.id);
    });
    const item = available.shift();
    if (item) chosen.push({ item, role, score: affinity(item, role, request) });
  }
  for (const role of new Set(request.roles)) {
    const wanted = request.roles.filter((candidate) => candidate === role).length;
    const strong = chosen.filter((entry) => entry.role === role && entry.score >= 3).length;
    if (strong < wanted)
      shortfalls.push(
        `Requested ${wanted} ${role} Program${wanted === 1 ? '' : 's'}, but only ${strong} strong match${strong === 1 ? ' is' : 'es are'} available.`,
      );
  }
  const seconds = chosen.reduce((sum, entry) => sum + entry.item.duration, 0);
  if (
    request.minutes &&
    Math.abs(seconds / 60 - request.minutes) > Math.max(2, request.minutes * 0.1)
  )
    shortfalls.push(
      `Requested ${request.minutes} minutes; whole existing Programs total ${(seconds / 60).toFixed(1)} minutes.`,
    );
  if (
    request.artistPreferences.length &&
    !chosen.some((entry) =>
      request.artistPreferences.some((artist) =>
        entry.item.program.name.toLowerCase().includes(artist.toLowerCase()),
      ),
    )
  )
    shortfalls.push(
      `No eligible Program matched the artist preference: ${request.artistPreferences.join(', ')}.`,
    );
  const entries = chosen.map(({ item, role }) => ({
    programId: item.program.id,
    name: item.program.name,
    role,
    duration: item.duration,
    explanation: `${role} match using its saved format/tags and ${Math.round(item.z4Ratio * 100)}% Z4, ${Math.round(item.hardRatio * 100)}% hard/all-out, ${Math.round(item.standingRatio * 100)}% standing section time.`,
  }));
  return {
    mode: interpretation.mode,
    model: interpretation.mode === 'openai' ? interpretation.model : null,
    requestedMinutes: request.minutes,
    actualMinutes: Math.round((seconds / 60) * 10) / 10,
    entries,
    shortfalls,
    eligibleCount: eligible.length,
    excludedCount: programs.length - eligible.length,
  };
}
