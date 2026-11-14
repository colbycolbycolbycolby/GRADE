import type { Analysis, Track } from '@grade/schema';
import { programFromAnalysis } from '@grade/core';
import { ApiClient } from '../api/client';
import type { Services } from '../app/services';
import { Storage } from '../storage/storage';
import { GradeDb } from '../storage/db';
import { ScreenWakeLock, type WakeLockApi } from '../playback';
import { FakeBackend, FakeClock } from '../playback/testkit';

export const TRACK_ID = 'yt:dQw4w9WgXcQ';

export const track: Track = {
  id: TRACK_ID,
  source: 'youtube',
  title: 'Test Song',
  duration: 125,
  aliases: [],
};

/** A 120 s song after a 2 s crop: four 30 s sections with rising energy. */
export function makeAnalysis(trackId = TRACK_ID): Analysis {
  const energy: { t: number; e: number }[] = [];
  for (let i = 0; i < 1250; i++) {
    const t = i / 10;
    energy.push({ t, e: t < 2 || t > 122 ? 0 : 0.2 + 0.2 * Math.min(Math.floor((t - 2) / 30), 3) });
  }
  return {
    trackId,
    version: 1,
    duration: 125,
    energy,
    boundaries: [32, 62, 92],
    cropStart: 2,
    cropEnd: 122,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

let counter = 0;
export const makeIdFactory =
  (prefix = 'id') =>
  () =>
    `${prefix}-${++counter}`;

export function makeProgram(name = 'Test Song') {
  return programFromAnalysis(
    makeAnalysis(),
    { id: 'p1', name, now: '2026-01-01T00:00:00Z' },
    { newId: makeIdFactory('seg') },
  );
}

export type FakeFetch = ReturnType<typeof makeFakeFetch>;

/** A tiny in-memory server that speaks the section 6.4 API. */
export function makeFakeFetch() {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const tracks = new Map<string, Track>([[TRACK_ID, track]]);
  const analyses = new Map<string, Analysis>([[TRACK_ID, makeAnalysis()]]);
  const jobs = new Map<
    string,
    { polls: number; trackId: string; fail?: { code: string; message: string } }
  >();
  const state = {
    failIngest: null as null | { status: number; code: string; message: string },
    failJob: null as null | { code: string; message: string },
  };

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const err = (status: number, code: string, message: string) => json({ code, message }, status);

  const fetchFn = async (input: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    calls.push({
      path: input,
      method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    });
    if (method === 'POST' && input.startsWith('/api/ingest/')) {
      if (state.failIngest)
        return err(state.failIngest.status, state.failIngest.code, state.failIngest.message);
      const jobId = `job-${jobs.size + 1}`;
      jobs.set(jobId, { polls: 0, trackId: TRACK_ID, fail: state.failJob ?? undefined });
      return json({ jobId, trackId: TRACK_ID });
    }
    const job = /^\/api\/jobs\/([^/]+)$/.exec(input);
    if (job) {
      const j = jobs.get(decodeURIComponent(job[1]!));
      if (!j) return err(404, 'not_found', 'There is no such job.');
      j.polls++;
      if (j.fail)
        return json({ status: 'error', progress: 0.3, trackId: j.trackId, error: j.fail });
      return json(
        j.polls < 2
          ? { status: 'running', progress: 0.5, trackId: j.trackId }
          : { status: 'done', progress: 1, trackId: j.trackId },
      );
    }
    const analysis = /^\/api\/tracks\/([^/]+)\/analysis$/.exec(input);
    if (analysis) {
      const a = analyses.get(decodeURIComponent(analysis[1]!));
      return a ? json(a) : err(404, 'not_found', 'There is no analysis for this track.');
    }
    const one = /^\/api\/tracks\/([^/]+)$/.exec(input);
    if (one) {
      const t = tracks.get(decodeURIComponent(one[1]!));
      return t ? json(t) : err(404, 'not_found', 'There is no such track.');
    }
    return err(404, 'not_found', 'No route.');
  };
  return { fetch: fetchFn, calls, tracks, analyses, state };
}

let dbCounter = 0;

export interface TestServices extends Services {
  fake: FakeFetch;
  clock: FakeClock;
  downloads: { filename: string; text: string }[];
  backends: FakeBackend[];
  /** Each `acquire` and `release` of the wake lock, in order. */
  wakeLog: string[];
}

/** Services with a real IndexedDB (fake-indexeddb), a fake server, and a fake audio backend. */
export function makeServices(dbName = `test-${++dbCounter}`): TestServices {
  const fake = makeFakeFetch();
  const clock = new FakeClock();
  const downloads: { filename: string; text: string }[] = [];
  const backends: FakeBackend[] = [];
  const wakeLog: string[] = [];
  const wakeApi: WakeLockApi = {
    request: async () => {
      wakeLog.push('request');
      return { release: async () => void wakeLog.push('release') };
    },
  };
  return {
    storage: new Storage(new GradeDb(dbName)),
    api: new ApiClient({ fetch: fake.fetch, sleep: async () => undefined }),
    createBackend: () => {
      const b = new FakeBackend(clock, true);
      backends.push(b);
      return b;
    },
    createContext: () =>
      ({ close: async () => undefined, resume: async () => undefined }) as unknown as AudioContext,
    createWakeLock: () => new ScreenWakeLock(wakeApi, document),
    now: () => '2026-02-02T00:00:00Z',
    newId: makeIdFactory('new'),
    download: (filename, text) => downloads.push({ filename, text }),
    fake,
    clock,
    downloads,
    backends,
    wakeLog,
  };
}
