import { describe, expect, test } from 'vitest';
import {
  AnalysisSchema,
  JobStatusSchema,
  ProgramFileSchema,
  SCHEMA_VERSION,
  TrackSchema,
} from '../src/index';

const program = {
  id: 'p1',
  name: 'Test',
  trackId: 'yt:dQw4w9WgXcQ',
  analysisVersion: 1,
  segments: [{ id: 's1', start: 0, end: 30, tier: 'easy', label: null, kind: 'section' }],
  clips: [{ id: 'c1', segmentId: 's1', start: 0, end: 30 }],
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('schema', () => {
  test('accepts a valid program file', () => {
    expect(ProgramFileSchema.safeParse({ schemaVersion: SCHEMA_VERSION, program }).success).toBe(
      true,
    );
  });
  test('legacy programs remain valid and structured cadence ranges are validated', () => {
    expect(ProgramFileSchema.safeParse({ schemaVersion: SCHEMA_VERSION, program }).success).toBe(
      true,
    );
    const structured = {
      ...program,
      tags: ['rolling_hills'],
      workoutFormat: 'hills_climb',
      segments: [
        {
          ...program.segments[0],
          resistanceZone: 4,
          cadence: { minRpm: 70, maxRpm: 80 },
          position: 'standing',
        },
      ],
    };
    expect(
      ProgramFileSchema.safeParse({ schemaVersion: SCHEMA_VERSION, program: structured }).success,
    ).toBe(true);
    structured.segments[0]!.cadence = { minRpm: 80, maxRpm: 70 };
    expect(
      ProgramFileSchema.safeParse({ schemaVersion: SCHEMA_VERSION, program: structured }).success,
    ).toBe(false);
  });
  test('rejects wrong schema version and bad tier', () => {
    expect(ProgramFileSchema.safeParse({ schemaVersion: 99, program }).success).toBe(false);
    const bad = { ...program, segments: [{ ...program.segments[0], tier: 'extreme' }] };
    expect(ProgramFileSchema.safeParse({ schemaVersion: 1, program: bad }).success).toBe(false);
  });
  test('track ids are prefixed', () => {
    const base = { source: 'youtube', title: 't', duration: 10, aliases: [] };
    expect(TrackSchema.safeParse({ ...base, id: 'yt:dQw4w9WgXcQ' }).success).toBe(true);
    expect(TrackSchema.safeParse({ ...base, id: 'dQw4w9WgXcQ' }).success).toBe(false);
  });
  test('analysis energy must be normalized', () => {
    const a = {
      trackId: 'yt:dQw4w9WgXcQ',
      version: 1,
      duration: 10,
      energy: [{ t: 0, e: 1.5 }],
      boundaries: [],
      cropStart: 0,
      cropEnd: 10,
      createdAt: 'x',
    };
    expect(AnalysisSchema.safeParse(a).success).toBe(false);
  });
  test('job status validates progress range', () => {
    expect(
      JobStatusSchema.safeParse({ status: 'running', progress: 2, trackId: 't' }).success,
    ).toBe(false);
  });
});
