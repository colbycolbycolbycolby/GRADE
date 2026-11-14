import { parseProgram, serializeProgram } from '@grade/core';
import type { Program } from '@grade/schema';
import type { Services } from './services';
import { ApiError } from '../api/client';

export function exportProgram(program: Program): { filename: string; text: string } {
  const safe = program.name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'program';
  return { filename: `${safe}.grade.json`, text: serializeProgram(program) };
}

/** Makes sure the track and its analysis are in local storage. Fetches them from the server if not. */
export async function ensureTrackData(services: Services, trackId: string): Promise<void> {
  const { storage, api } = services;
  const [track, analysis] = await Promise.all([
    storage.getTrack(trackId),
    storage.getAnalysis(trackId),
  ]);
  if (track && analysis) return;
  try {
    const [t, a] = await Promise.all([api.getTrack(trackId), api.getAnalysis(trackId)]);
    await storage.saveTrack(t);
    await storage.saveAnalysis(a);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'not_found') {
      throw new ApiError(
        'not_found',
        'This program uses a song that this server does not have. Import the song first.',
        404,
      );
    }
    throw err;
  }
}

/** Reads an exported program. The copy gets a new id, so it never replaces an existing program. */
export async function importProgramText(services: Services, text: string): Promise<Program> {
  const parsed = parseProgram(text);
  await ensureTrackData(services, parsed.trackId);
  const program: Program = { ...parsed, id: services.newId(), updatedAt: services.now() };
  await services.storage.saveProgram(program);
  return program;
}

/** Total class length in seconds. */
export function classSeconds(program: Program): number {
  return program.clips.reduce((sum, c) => sum + (c.end - c.start), 0);
}
