// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { YouTubeEmbedBackend, type YTApi, type YTPlayerOptions } from './youtube';

function fakeApi() {
  const log: string[] = [];
  let time = 0;
  let options!: YTPlayerOptions;
  const api: YTApi = {
    Player: class {
      constructor(_el: HTMLElement | string, o: YTPlayerOptions) {
        options = o;
        queueMicrotask(() => o.events.onReady());
      }
      playVideo() {
        log.push('play');
      }
      pauseVideo() {
        log.push('pause');
      }
      seekTo(s: number) {
        log.push(`seek ${s}`);
        time = s;
      }
      getCurrentTime() {
        return time;
      }
      destroy() {
        log.push('destroy');
      }
    },
  };
  return { api, log, options: () => options };
}

test('all capabilities are false', () => {
  const backend = new YouTubeEmbedBackend('x', async () => fakeApi().api);
  expect(backend.capabilities).toEqual({
    sampleAccurate: false,
    crossfade: false,
    backgroundPlayback: false,
  });
  expect('scheduleJump' in backend).toBe(false);
});

test('drives the player and reports its position', async () => {
  const { api, log, options } = fakeApi();
  const backend = new YouTubeEmbedBackend('x', async () => api);
  await backend.load({ id: 'yt:abcdefghijk', youtubeId: 'abcdefghijk' });
  expect(options().videoId).toBe('abcdefghijk');
  await backend.play();
  await backend.seek(42);
  backend.pause();
  expect(log).toEqual(['play', 'seek 42', 'pause']);
  expect(backend.position).toBe(42);
  backend.dispose();
  expect(log).toContain('destroy');
});

test('state change "ended" notifies listeners', async () => {
  const { api, options } = fakeApi();
  const backend = new YouTubeEmbedBackend('x', async () => api);
  await backend.load({ id: 'yt:abcdefghijk', youtubeId: 'abcdefghijk' });
  const ended = vi.fn();
  backend.onEnded(ended);
  options().events.onStateChange({ data: 1 });
  expect(ended).not.toHaveBeenCalled();
  options().events.onStateChange({ data: 0 });
  expect(ended).toHaveBeenCalledTimes(1);
});

test('load needs a youtube id', async () => {
  const backend = new YouTubeEmbedBackend('x', async () => fakeApi().api);
  await expect(backend.load({ id: 'file:x', url: '/a' })).rejects.toThrow();
});

test('owns and removes an offscreen host when none is supplied', () => {
  const before = document.body.children.length;
  const backend = new YouTubeEmbedBackend(undefined, async () => fakeApi().api);
  expect(document.body.children.length).toBe(before + 1);
  backend.dispose();
  expect(document.body.children.length).toBe(before);
});
