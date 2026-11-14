// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { ClassPlan } from '@grade/schema';
import {
  makeAnalysis,
  makeProgram,
  makeServices,
  track,
  type TestServices,
} from '../testing/fixtures';
import {
  button,
  byLabel,
  click,
  render,
  setValue,
  settle,
  until,
  type Mounted,
} from '../testing/dom';
import App from '../App.svelte';

let services: TestServices;
let view: Mounted | undefined;

async function start(hash = '') {
  location.hash = hash;
  view = render(App, { services });
  await settle();
  return view.target;
}

/** Moves the fake clock in steps, the way the real timer would, and lets Svelte update. */
async function advance(seconds: number) {
  for (let left = seconds; left > 0; left -= 1) {
    services.clock.advance(Math.min(left, 1));
    await settle();
  }
}

const shown = (root: HTMLElement, sel: string) =>
  root.querySelector(sel)?.textContent?.trim() ?? '';
const nav = async () => {
  await new Promise((r) => setTimeout(r, 30));
  await settle();
};

async function seed(programs: string[], plan?: ClassPlan) {
  await services.storage.saveTrack(track);
  await services.storage.saveAnalysis(makeAnalysis());
  for (const [i, name] of programs.entries()) {
    await services.storage.saveProgram({ ...makeProgram(name), id: `p${i + 1}` });
  }
  if (plan) await services.storage.saveClassPlan(plan);
}

beforeEach(() => {
  document.body.innerHTML = '';
  services = makeServices();
});
afterEach(async () => {
  await view?.destroy();
  view = undefined;
  location.hash = '';
});

describe('class runner', () => {
  test('smoke: import, edit, start class, run the schedule, leave', async () => {
    const root = await start('#/import');
    await setValue(
      root.querySelector<HTMLInputElement>('input[type="url"]')!,
      'https://youtu.be/dQw4w9WgXcQ',
      'input',
    );
    await click(button(root, 'Analyze song'));
    await until(
      () => root.querySelector('.labels .label'),
      (el) => el !== null,
    );
    await click(button(byLabel(root, 'Intensity'), 'All out'));
    const programId = decodeURIComponent(location.hash.replace('#/program/', ''));

    // The editor opens the runner. It flushes the edit when it closes.
    root.querySelector<HTMLAnchorElement>('a.button')!.click();
    await nav();
    expect(location.hash).toBe(`#/run/program/${encodeURIComponent(programId)}`);
    await until(
      () => button(root, 'Start class').disabled,
      (d) => d === false,
    );
    expect(services.wakeLog).toEqual([]);

    await click(button(root, 'Start class'));
    await until(
      () => shown(root, '.cue'),
      (t) => t !== '',
    );
    expect(services.wakeLog).toEqual(['request']); // requested on start
    expect(shown(root, '.cue')).toBe('All out'); // the edit reached the runner
    expect(root.querySelector('.runner')!.getAttribute('data-tier')).toBe('allout');
    const first = shown(root, '[role="timer"]');
    expect(first).toBe('0:30');
    expect(root.querySelectorAll('.next li')).toHaveLength(3);

    await advance(10);
    expect(shown(root, '[role="timer"]')).toBe('0:20');

    // Cross into the second block.
    await advance(20);
    expect(shown(root, '.top')).toMatch(/0:3\d \/ 2:00/);
    expect(root.querySelector('h1')!.textContent).toMatch(/Section 2/);
    expect(root.querySelector('.runner')!.getAttribute('data-tier')).not.toBe('allout');

    await click(button(root, 'End class'));
    await click(button(root, 'Tap again to end'));
    await nav();
    expect(services.wakeLog).toEqual(['request', 'release']); // released on exit
    expect(location.hash).toBe(`#/program/${encodeURIComponent(programId)}`);
  });

  test('play, pause and skip reach the audio', async () => {
    await seed(['One']);
    const root = await start('#/run/program/p1');
    await until(
      () => button(root, 'Start class').disabled,
      (d) => d === false,
    );
    await click(button(root, 'Start class'));
    await until(
      () => shown(root, '.cue'),
      (t) => t !== '',
    );
    const backend = services.backends[0]!;
    expect(backend.playing).toBe(true);
    await click(button(root, 'Pause'));
    expect(backend.playing).toBe(false);
    expect(button(root, 'Play')).toBeTruthy();
    await click(byLabel(root, 'Forward 10 seconds'));
    expect(shown(root, '[role="timer"]')).toBe('0:20');
    await click(button(root, 'Play'));
    expect(backend.playing).toBe(true);
  });

  test('a class plan runs its songs in order and ends with a message', async () => {
    await seed(['One', 'Two', 'Three'], {
      id: 'plan1',
      name: 'Friday',
      programIds: ['p1', 'p2', 'p3'],
    });
    const root = await start('#/run/plan/plan1');
    await until(
      () => root.textContent ?? '',
      (t) => /3\s+songs/.test(t),
    );
    await until(
      () => button(root, 'Start class').disabled,
      (d) => d === false,
    );
    await click(button(root, 'Start class'));
    await until(
      () => shown(root, '.top'),
      (t) => /Song 1 of 3/.test(t),
    );

    await advance(121);
    expect(shown(root, '.top')).toMatch(/Song 2 of 3/);
    await click(button(root, 'Next song'));
    expect(shown(root, '.top')).toMatch(/Song 3 of 3/);
    expect(button(root, 'Finish class')).toBeTruthy();
    await advance(121);
    await until(
      () => root.textContent ?? '',
      (t) => /Class finished/.test(t),
    );
    expect(services.wakeLog).toEqual(['request', 'release']);
  });

  test('without the wake lock API the runner tells the instructor', async () => {
    await seed(['One']);
    const { ScreenWakeLock } = await import('../playback');
    services.createWakeLock = () => new ScreenWakeLock(undefined, document);
    const root = await start('#/run/program/p1');
    await until(
      () => button(root, 'Start class').disabled,
      (d) => d === false,
    );
    await click(button(root, 'Start class'));
    await until(
      () => shown(root, '.cue'),
      (t) => t !== '',
    );
    expect(root.textContent).toMatch(/cannot keep the screen on/);
  });

  test('a program that does not exist shows a message', async () => {
    const root = await start('#/run/program/nope');
    await until(
      () => root.querySelector('[role="alert"]')?.textContent ?? '',
      (t) => /does not exist/.test(t),
    );
  });

  test('a plan that lists a deleted program shows a message', async () => {
    await seed(['One'], { id: 'plan1', name: 'Friday', programIds: ['p1', 'gone'] });
    const root = await start('#/run/plan/plan1');
    await until(
      () => root.querySelector('[role="alert"]')?.textContent ?? '',
      (t) => /deleted/.test(t),
    );
  });

  test('a failed audio load shows the reason and the class does not start', async () => {
    await seed(['One']);
    services.createBackend = () => {
      return {
        capabilities: { sampleAccurate: false, crossfade: false, backgroundPlayback: false },
        position: 0,
        load: async () => Promise.reject(new Error('audio request failed: 404')),
        play: async () => undefined,
        pause: () => undefined,
        seek: async () => undefined,
        onPosition: () => () => undefined,
        onEnded: () => () => undefined,
        dispose: () => undefined,
      };
    };
    const root = await start('#/run/program/p1');
    await until(
      () => button(root, 'Start class').disabled,
      (d) => d === false,
    );
    await click(button(root, 'Start class'));
    await until(
      () => root.querySelector('[role="alert"]')?.textContent ?? '',
      (t) => /404/.test(t),
    );
    expect(root.querySelector('.runner')).toBeNull();
    expect(services.wakeLog.at(-1)).not.toBe('request'); // the lock is released after a failed start
  });
});

describe('class plan page', () => {
  test('make a plan from the library, add, move, remove, rename', async () => {
    await seed(['One', 'Two']);
    const root = await start();
    await until(
      () => root.textContent ?? '',
      (t) => /One/.test(t),
    );
    await click(button(root, 'New class plan'));
    await until(
      () => root.querySelector('h1')?.textContent ?? '',
      (t) => t === 'Class plan',
    );
    const select = byLabel<HTMLSelectElement>(root, 'Program to add');
    await setValue(select, 'p1');
    await click(button(root, 'Add to plan'));
    await setValue(select, 'p2');
    await click(button(root, 'Add to plan'));
    const names = () => [...root.querySelectorAll('li strong')].map((e) => e.textContent);
    expect(names()).toEqual(['One', 'Two']);
    await click(root.querySelectorAll<HTMLButtonElement>('[aria-label="Move down"]')[0]!);
    expect(names()).toEqual(['Two', 'One']);
    await setValue(byLabel<HTMLInputElement>(root, 'Plan name'), 'Friday');

    const plan = (await services.storage.listClassPlans())[0]!;
    expect(plan.name).toBe('Friday');
    expect(plan.programIds).toEqual(['p2', 'p1']);

    await click(root.querySelectorAll<HTMLButtonElement>('[aria-label="Remove from plan"]')[0]!);
    expect(names()).toEqual(['One']);
    expect((await services.storage.listClassPlans())[0]!.programIds).toEqual(['p1']);
  });

  test('an empty plan cannot start, and a plan with a deleted program cannot start', async () => {
    await seed(['One'], { id: 'plan1', name: 'Empty', programIds: [] });
    let root = await start('#/plan/plan1');
    await until(
      () => root.querySelector('h1')?.textContent ?? '',
      (t) => t === 'Class plan',
    );
    expect(button(root, 'Start class').disabled).toBe(true);
    await view!.destroy();

    await services.storage.saveClassPlan({ id: 'plan1', name: 'Gone', programIds: ['p1', 'gone'] });
    root = await start('#/plan/plan1');
    await until(
      () => root.textContent ?? '',
      (t) => /was deleted/.test(t),
    );
    expect(button(root, 'Start class').disabled).toBe(true);
  });

  test('delete needs a second tap and returns to the library', async () => {
    await seed(['One'], { id: 'plan1', name: 'Friday', programIds: ['p1'] });
    const root = await start('#/plan/plan1');
    await until(
      () => root.querySelector('h1')?.textContent ?? '',
      (t) => t === 'Class plan',
    );
    await click(button(root, 'Delete plan'));
    expect(await services.storage.listClassPlans()).toHaveLength(1);
    await click(button(root, 'Tap again to delete'));
    await nav();
    expect(await services.storage.listClassPlans()).toEqual([]);
    expect(location.hash).toBe('#/');
  });

  test('the library lists plans and programs with a start link', async () => {
    await seed(['One'], { id: 'plan1', name: 'Friday', programIds: ['p1'] });
    const root = await start();
    await until(
      () => root.textContent ?? '',
      (t) => /Friday/.test(t),
    );
    const links = [...root.querySelectorAll('a.button')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['#/settings', '#/run/program/p1', '#/run/plan/plan1']);
  });
});
