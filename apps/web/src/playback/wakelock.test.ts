// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { ScreenWakeLock, type WakeLockApi, type WakeLockSentinelLike } from './wakelock';

function fakeApi(opts: { fail?: boolean } = {}) {
  const log: string[] = [];
  const releaseHandlers: (() => void)[] = [];
  const api: WakeLockApi = {
    async request() {
      log.push('request');
      if (opts.fail) throw new Error('NotAllowedError');
      const sentinel: WakeLockSentinelLike = {
        async release() {
          log.push('release');
        },
        addEventListener(_type, cb) {
          releaseHandlers.push(cb);
        },
      };
      return sentinel;
    },
  };
  return { api, log, releaseHandlers };
}

function hide(visible: boolean) {
  Object.defineProperty(document, 'visibilityState', {
    value: visible ? 'visible' : 'hidden',
    configurable: true,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('ScreenWakeLock', () => {
  test('acquire requests the lock and release gives it back', async () => {
    const { api, log } = fakeApi();
    const lock = new ScreenWakeLock(api, document);
    expect(await lock.acquire()).toBe(true);
    expect(lock.held).toBe(true);
    await lock.release();
    expect(lock.held).toBe(false);
    expect(log).toEqual(['request', 'release']);
  });

  test('without the API it reports unsupported and does not throw', async () => {
    const lock = new ScreenWakeLock(undefined, document);
    expect(lock.supported).toBe(false);
    expect(await lock.acquire()).toBe(false);
    await lock.release();
  });

  test('a refused request returns false', async () => {
    const { api } = fakeApi({ fail: true });
    const lock = new ScreenWakeLock(api, document);
    expect(await lock.acquire()).toBe(false);
    expect(lock.held).toBe(false);
  });

  test('it asks again when the page becomes visible after the browser dropped the lock', async () => {
    const { api, log, releaseHandlers } = fakeApi();
    const lock = new ScreenWakeLock(api, document);
    await lock.acquire();
    hide(false);
    releaseHandlers[0]!(); // the browser drops the lock when the page hides
    expect(lock.held).toBe(false);
    hide(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(['request', 'request']);
    expect(lock.held).toBe(true);
    await lock.release();
  });

  test('after release the page no longer asks again', async () => {
    const { api, log } = fakeApi();
    const lock = new ScreenWakeLock(api, document);
    await lock.acquire();
    await lock.release();
    hide(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(['request', 'release']);
  });

  test('a release that comes while the request is open does not keep the lock', async () => {
    const { api, log } = fakeApi();
    const lock = new ScreenWakeLock(api, document);
    const pending = lock.acquire();
    await lock.release();
    expect(await pending).toBe(false);
    expect(lock.held).toBe(false);
    expect(log).toEqual(['request', 'release']);
  });
});
