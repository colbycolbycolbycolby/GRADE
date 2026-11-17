import { z } from 'zod';

export const SCHEMA_VERSION = 1;

export const TierSchema = z.enum(['easy', 'moderate', 'hard', 'allout']);
export type Tier = z.infer<typeof TierSchema>;
export const TIERS: readonly Tier[] = TierSchema.options;

const seconds = z.number().finite().nonnegative();

export const TrackSchema = z.object({
  id: z.string().regex(/^(file:[0-9a-f]{64}|yt:[A-Za-z0-9_-]{11}|mic:.+)$/),
  source: z.enum(['file', 'youtube', 'mic']),
  title: z.string(),
  duration: seconds,
  aliases: z.array(z.string()),
});
export type Track = z.infer<typeof TrackSchema>;

export const AnalysisSchema = z.object({
  trackId: z.string(),
  version: z.number().int().nonnegative(),
  duration: seconds,
  energy: z.array(z.object({ t: seconds, e: z.number().min(0).max(1) })),
  bpm: z.number().positive().optional(),
  beats: z.array(seconds).optional(),
  downbeats: z.array(seconds).optional(),
  /** Original-file time. Strictly inside (cropStart, cropEnd). */
  boundaries: z.array(seconds),
  /** One entry per section (boundaries.length + 1), in order, covering [cropStart, cropEnd]. */
  structure: z
    .array(
      z.object({
        kind: z.enum(['intro', 'outro', 'section']),
        /** Index of the earliest section this one sounds like. */
        similarTo: z.number().int().nonnegative().optional(),
      }),
    )
    .optional(),
  cropStart: seconds,
  cropEnd: seconds,
  createdAt: z.string(),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export const SegmentSchema = z.object({
  id: z.string(),
  start: seconds,
  end: seconds,
  tier: TierSchema,
  label: z.string().nullable(),
  kind: z.enum(['intro', 'outro', 'section']),
  similarTo: z.string().optional(),
});
export type Segment = z.infer<typeof SegmentSchema>;

export const ClipSchema = z.object({
  id: z.string(),
  segmentId: z.string(),
  start: seconds,
  end: seconds,
});
export type Clip = z.infer<typeof ClipSchema>;

export const ProgramSchema = z.object({
  id: z.string(),
  name: z.string(),
  trackId: z.string(),
  analysisVersion: z.number().int().nonnegative(),
  segments: z.array(SegmentSchema).min(1),
  clips: z.array(ClipSchema).min(1),
  updatedAt: z.string(),
});
export type Program = z.infer<typeof ProgramSchema>;

export const ClassPlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  programIds: z.array(z.string()),
});
export type ClassPlan = z.infer<typeof ClassPlanSchema>;

export const RideTypeSchema = z.enum(['warmup', 'hill', 'sprint', 'recovery', 'surprise']);
export type RideType = z.infer<typeof RideTypeSchema>;

export const PlaylistRequestSchema = z.object({
  artist: z.string().nullable().optional(),
  song_count: z.number().int().positive().nullable().optional(),
  duration_minutes: z.number().positive().nullable().optional(),
  intensity: z.enum(['low', 'moderate', 'high']).nullable().optional(),
  ride_types: z.record(RideTypeSchema, z.number().int().nonnegative()),
  revision: z
    .object({
      action: z.literal('replace'),
      position: z.number().int().positive(),
      ride_type: RideTypeSchema.nullable().optional(),
      harder: z.boolean(),
      target_title: z.string().nullable().optional(),
      replacement_title: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type PlaylistRequest = z.infer<typeof PlaylistRequestSchema>;

export const PlaylistEntrySchema = z.object({
  position: z.number().int().positive(),
  track_id: z.string(),
  title: z.string(),
  purpose: RideTypeSchema,
  bpm: z.number().positive().nullable(),
  energy: z.number(),
  duration: seconds,
  explanation: z.string(),
});
export type PlaylistEntry = z.infer<typeof PlaylistEntrySchema>;

export const PlaylistProposalSchema = z.object({
  status: z.enum(['complete', 'partial', 'impossible']),
  understood_request: PlaylistRequestSchema,
  summary: z.string(),
  entries: z.array(PlaylistEntrySchema),
  shortfalls: z.array(z.string()),
  validation: z.object({
    valid_track_ids: z.boolean(),
    unique_tracks: z.boolean(),
    requested_song_count: z.number().int().positive().nullable(),
    actual_song_count: z.number().int().nonnegative(),
    requested_duration_minutes: z.number().positive().nullable(),
    actual_duration_minutes: z.number().nonnegative(),
    requested_ride_types: z.record(RideTypeSchema, z.number().int().nonnegative()),
    actual_ride_types: z.record(RideTypeSchema, z.number().int().nonnegative()),
    satisfied: z.boolean(),
  }),
});
export type PlaylistProposal = z.infer<typeof PlaylistProposalSchema>;

/** File format for exported programs. */
export const ProgramFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  program: ProgramSchema,
});
export type ProgramFile = z.infer<typeof ProgramFileSchema>;

// ---- API payloads (architecture.md 6.4) ----

export const ERROR_CODES = [
  'invalid_url',
  'unsupported_host',
  'playlist_not_supported',
  'too_long',
  'video_unavailable',
  'age_restricted',
  'blocked',
  'download_failed',
  'analysis_failed',
  'unsupported_audio',
  'too_many_jobs',
  'not_found',
  'bad_request',
  'range_not_satisfiable',
  'forbidden',
] as const;
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorSchema = z.object({ code: z.string(), message: z.string() });
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const IngestYoutubeRequestSchema = z.object({ url: z.string().min(1) });
export type IngestYoutubeRequest = z.infer<typeof IngestYoutubeRequestSchema>;

export const IngestResponseSchema = z.object({ jobId: z.string(), trackId: z.string() });
export type IngestResponse = z.infer<typeof IngestResponseSchema>;

export const JobStatusSchema = z.object({
  status: z.enum(['queued', 'running', 'done', 'error']),
  progress: z.number().min(0).max(1),
  error: ApiErrorSchema.optional(),
  trackId: z.string(),
});
export type JobStatus = z.infer<typeof JobStatusSchema>;
