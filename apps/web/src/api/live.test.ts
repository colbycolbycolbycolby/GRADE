/**
 * Opt-in: runs the web client against a real server.
 *   cd apps/server && GRADE_DATA_DIR=/tmp/grade-live uv run uvicorn api.app:create_app --factory
 *   GRADE_LIVE_URL=http://127.0.0.1:8000 GRADE_LIVE_FILE=/path/to/song.wav pnpm --filter @grade/web test
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { expect, test } from 'vitest';
import { programFromAnalysis } from '@grade/core';
import { ApiClient } from './client';

const base = process.env.GRADE_LIVE_URL;
const file = process.env.GRADE_LIVE_FILE;

test.skipIf(!base || !file)('client and real server agree on every payload', async () => {
  const api = new ApiClient({ baseUrl: base });
  const bytes = readFileSync(file!);
  const started = await api.ingestFile(new File([bytes], basename(file!)));
  const job = await api.waitForJob(started.jobId, undefined, { intervalMs: 300 });
  expect(job.status).toBe('done');
  const track = await api.getTrack(started.trackId);
  const analysis = await api.getAnalysis(started.trackId);
  expect(track.source).toBe('file');
  const program = programFromAnalysis(analysis, {
    name: track.title,
    now: new Date().toISOString(),
  });
  expect(program.segments.length).toBeGreaterThan(1);
  const audio = await fetch(api.audioUrl(started.trackId), { headers: { Range: 'bytes=0-99' } });
  expect(audio.status).toBe(206);
  const again = await api.ingestFile(new File([bytes], basename(file!)));
  expect((await api.getJob(again.jobId)).status).toBe('done'); // cache hit
  await expect(api.getTrack('yt:AAAAAAAAAAA')).rejects.toMatchObject({ code: 'not_found' });
});
