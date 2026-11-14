// Writes json/schema.json: JSON Schema for every payload, used by the Python contract tests.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as s from '../src/index';

const definitions = {
  Track: s.TrackSchema,
  Analysis: s.AnalysisSchema,
  Segment: s.SegmentSchema,
  Clip: s.ClipSchema,
  Program: s.ProgramSchema,
  ProgramFile: s.ProgramFileSchema,
  ClassPlan: s.ClassPlanSchema,
  ApiError: s.ApiErrorSchema,
  IngestYoutubeRequest: s.IngestYoutubeRequestSchema,
  IngestResponse: s.IngestResponseSchema,
  JobStatus: s.JobStatusSchema,
};

const out = zodToJsonSchema(s.ProgramFileSchema, { name: 'ProgramFile', definitions });
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'json');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'schema.json'), JSON.stringify(out, null, 2) + '\n');
