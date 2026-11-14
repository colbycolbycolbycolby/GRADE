import { describe, expect, test, vi } from 'vitest';
import { makeAnalysis, makeFakeFetch, track } from '../testing/fixtures';
import { ApiClient, ApiError } from './client';

const sleep = async () => undefined;

function client() {
  const fake = makeFakeFetch();
  return { fake, api: new ApiClient({ fetch: fake.fetch, sleep }) };
}

describe('ApiClient', () => {
  test('ingestYoutube posts the url', async () => {
    const { fake, api } = client();
    const res = await api.ingestYoutube('https://youtu.be/dQw4w9WgXcQ');
    expect(res.trackId).toBe(track.id);
    expect(fake.calls[0]).toMatchObject({
      path: '/api/ingest/youtube',
      method: 'POST',
      body: { url: 'https://youtu.be/dQw4w9WgXcQ' },
    });
  });

  test('ingestFile sends multipart form data', async () => {
    const { fake, api } = client();
    await api.ingestFile(new File([new Uint8Array([1, 2, 3])], 'song.mp3'));
    const body = fake.calls[0]!.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect((body.get('file') as File).name).toBe('song.mp3');
  });

  test('reads tracks and analyses and checks them against the schema', async () => {
    const { api } = client();
    expect((await api.getTrack(track.id)).title).toBe('Test Song');
    expect((await api.getAnalysis(track.id)).cropStart).toBe(2);
  });

  test('a server error keeps its code and message', async () => {
    const { fake, api } = client();
    fake.state.failIngest = { status: 400, code: 'unsupported_host', message: 'Only YouTube.' };
    const err = await api.ingestYoutube('https://vimeo.com/1').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'unsupported_host', message: 'Only YouTube.', status: 400 });
  });

  test('a network failure becomes network_error', async () => {
    const api = new ApiClient({ fetch: () => Promise.reject(new TypeError('fail')) });
    await expect(api.getTrack('yt:x')).rejects.toMatchObject({ code: 'network_error' });
  });

  test('an unreadable or wrong-shaped answer becomes bad_response', async () => {
    const html = new ApiClient({ fetch: async () => new Response('<html>', { status: 200 }) });
    await expect(html.getTrack('yt:x')).rejects.toMatchObject({ code: 'bad_response' });
    const wrong = new ApiClient({
      fetch: async () => new Response(JSON.stringify({ id: 1 }), { status: 200 }),
    });
    await expect(wrong.getTrack('yt:x')).rejects.toMatchObject({ code: 'bad_response' });
    const odd = new ApiClient({ fetch: async () => new Response('{"x":1}', { status: 500 }) });
    await expect(odd.getTrack('yt:x')).rejects.toMatchObject({ code: 'bad_response', status: 500 });
  });

  test('waitForJob reports progress and resolves when done', async () => {
    const { api } = client();
    const { jobId } = await api.ingestYoutube('https://youtu.be/dQw4w9WgXcQ');
    const seen: number[] = [];
    const job = await api.waitForJob(jobId, (p) => seen.push(p));
    expect(job.status).toBe('done');
    expect(seen).toEqual([0.5, 1]);
  });

  test('waitForJob throws the job error', async () => {
    const { fake, api } = client();
    fake.state.failJob = { code: 'too_long', message: 'Too long.' };
    const { jobId } = await api.ingestYoutube('https://youtu.be/dQw4w9WgXcQ');
    await expect(api.waitForJob(jobId)).rejects.toMatchObject({ code: 'too_long' });
  });

  test('waitForJob stops when aborted', async () => {
    const { fake } = client();
    const controller = new AbortController();
    const api = new ApiClient({
      fetch: fake.fetch,
      sleep: async (_ms, signal) => {
        controller.abort();
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      },
    });
    const { jobId } = await api.ingestYoutube('https://youtu.be/dQw4w9WgXcQ');
    await expect(api.waitForJob(jobId, undefined, { signal: controller.signal })).rejects.toThrow(
      /abort/,
    );
  });

  test('audioUrl encodes the track id', () => {
    expect(client().api.audioUrl('yt:abc')).toBe('/api/tracks/yt%3Aabc/audio');
    expect(new ApiClient({ baseUrl: 'http://h' }).audioUrl('yt:abc')).toBe(
      'http://h/api/tracks/yt%3Aabc/audio',
    );
  });

  test('uses the real fetch by default', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(makeAnalysis()), { status: 200 }));
    await new ApiClient().getAnalysis(track.id);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
