// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
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
import { GradeDb } from '../storage/db';
import { Storage, StorageError } from '../storage/storage';

let services: TestServices;
let view: Mounted | undefined;

async function start(hash = '') {
  location.hash = hash;
  const mounted = render(App, { services });
  view = mounted;
  await settle();
  return mounted.target;
}

const nav = async () => {
  await new Promise((r) => setTimeout(r, 30));
  await settle();
};

beforeEach(() => {
  document.body.innerHTML = '';
  services = makeServices();
});
afterEach(async () => {
  await view?.destroy();
  view = undefined;
  location.hash = '';
});

describe('App', () => {
  test('an empty library invites the user to make a program', async () => {
    const root = await start();
    await until(
      () => root.textContent ?? '',
      (t) => /No programs yet/.test(t),
    );
  });

  test('import a YouTube link, wait for the analysis, and land in the editor', async () => {
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
    expect(location.hash).toMatch(/^#\/program\//);
    expect(root.querySelectorAll('.labels .label')).toHaveLength(4);
    const programs = await services.storage.listPrograms();
    expect(programs).toHaveLength(1);
    expect(programs[0]!.name).toBe('Test Song');
    expect(await services.storage.getTrack('yt:dQw4w9WgXcQ')).toBeDefined();
    expect(await services.storage.getAnalysis('yt:dQw4w9WgXcQ')).toBeDefined();
  });

  test('import an audio file', async () => {
    const root = await start('#/import');
    await click(root.querySelector<HTMLInputElement>('input[type="radio"][value="file"]')!);
    const input = root.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', {
      value: [new File([new Uint8Array(4)], 'song.mp3')],
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    await click(button(root, 'Analyze song'));
    await until(
      () => root.querySelector('.labels .label'),
      (el) => el !== null,
    );
    expect(services.fake.calls[0]!.path).toBe('/api/ingest/file');
  });

  test('the submit button waits for input', async () => {
    const root = await start('#/import');
    expect(button(root, 'Analyze song').disabled).toBe(true);
  });

  test('a server refusal shows its message and stays on the form', async () => {
    services.fake.state.failIngest = {
      status: 400,
      code: 'unsupported_host',
      message: 'Only YouTube links work.',
    };
    const root = await start('#/import');
    await setValue(
      root.querySelector<HTMLInputElement>('input[type="url"]')!,
      'https://vimeo.com/1',
      'input',
    );
    await click(button(root, 'Analyze song'));
    await until(
      () => root.querySelector('[role="alert"]')?.textContent ?? '',
      (t) => /Only YouTube/.test(t),
    );
    expect(location.hash).toBe('#/import');
  });

  test('a failed analysis shows the error and a way back', async () => {
    services.fake.state.failJob = {
      code: 'too_long',
      message: 'The video is longer than 15 minutes.',
    };
    const root = await start('#/import');
    await setValue(
      root.querySelector<HTMLInputElement>('input[type="url"]')!,
      'https://youtu.be/dQw4w9WgXcQ',
      'input',
    );
    await click(button(root, 'Analyze song'));
    await until(
      () => root.querySelector('[role="alert"]')?.textContent ?? '',
      (t) => /15 minutes/.test(t),
    );
    expect(button(root, 'Try another song')).toBeTruthy();
    expect(await services.storage.listPrograms()).toEqual([]);
  });

  test('edit, leave, reload: the edit is still there', async () => {
    let root = await start('#/import');
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
    await setValue(byLabel<HTMLInputElement>(root, 'Section name'), 'Big hill');
    const id = decodeURIComponent(location.hash.replace('#/program/', ''));
    await until(
      () => services.storage.getProgram(id),
      (p) => p?.segments[0]?.label === 'Big hill',
    );

    // Go to the library: the editor leaves and saves.
    location.hash = '#/';
    await nav();
    expect(root.textContent).toMatch(/Test Song/);

    // A page reload: a new Storage object on the same IndexedDB.
    await view!.destroy();
    services = { ...services, storage: new Storage(new GradeDb(services.storage.db.name)) };
    root = await start(`#/program/${encodeURIComponent(id)}`);
    await until(
      () => root.querySelector('.labels .label .name')?.textContent,
      (t) => t === 'Big hill',
    );
    expect(button(byLabel(root, 'Intensity'), 'All out').getAttribute('aria-pressed')).toBe('true');
  });

  test('export a program, delete it, import the file', async () => {
    let root = await start('#/import');
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
    await click(button(root, 'Export'));
    const file = services.downloads[0]!;

    location.hash = '#/';
    await nav();
    await click(button(root, 'Delete'));
    await click(button(root, 'Tap again to delete'));
    await until(
      () => root.textContent ?? '',
      (t) => /No programs yet/.test(t),
    );

    const input = root.querySelector<HTMLInputElement>('.file input[type="file"]')!;
    Object.defineProperty(input, 'files', {
      value: [new File([file.text], file.filename, { type: 'application/json' })],
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await until(
      () => root.querySelector('.labels .label'),
      (el) => el !== null,
    );
    root = view!.target;
    expect(await services.storage.listPrograms()).toHaveLength(1);
  });

  test('importing a broken file shows an error in the library', async () => {
    const root = await start();
    await nav();
    const input = root.querySelector<HTMLInputElement>('.file input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['nope'], 'x.json')] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await until(
      () => root.querySelector('[role="alert"]')?.textContent ?? '',
      (t) => /JSON/.test(t),
    );
  });

  test('a program that does not exist shows a message', async () => {
    const root = await start('#/program/nope');
    await until(
      () => root.querySelector('[role="alert"]')?.textContent ?? '',
      (t) => /does not exist/.test(t),
    );
  });

  test('a blocked database shows a banner', async () => {
    services.storage.check = async () => {
      throw new StorageError('Could not open storage.');
    };
    const root = await start();
    await until(
      () => root.querySelector('[role="alert"]')?.textContent ?? '',
      (t) => /Could not open storage/.test(t),
    );
  });

  test('planner reuses an instructor Program unchanged and saves a playable class plan', async () => {
    const instructorProgram = makeProgram('Instructor hill');
    instructorProgram.segments[0] = {
      ...instructorProgram.segments[0]!,
      label: 'Climb Z4 60 standing',
    };
    await services.storage.saveTrack(track);
    await services.storage.saveAnalysis(makeAnalysis());
    await services.storage.saveProgram(instructorProgram);
    const root = await start('#/planner');
    await setValue(
      root.querySelector<HTMLTextAreaElement>('textarea')!,
      'Make me one hill song.',
      'input',
    );
    await until(
      () => root.textContent ?? '',
      (text) => /Build from my Programs/.test(text),
    );
    await click(button(root, 'Build from my Programs'));
    await until(
      () => root.textContent ?? '',
      (text) => /Instructor hill/.test(text),
    );
    await click(button(root, 'Save existing Programs as ClassPlan'));
    await until(
      () => location.hash,
      (hash) => /^#\/plan\//.test(hash),
    );
    expect((await services.storage.listClassPlans())[0]?.programIds).toHaveLength(1);
    expect(await services.storage.listPrograms()).toEqual([instructorProgram]);
    await until(
      () => root.textContent ?? '',
      (text) => /Start class/.test(text),
    );
    await click(button(root, 'Start class'));
    await until(
      () => location.hash,
      (hash) => /^#\/run\/plan\//.test(hash),
    );
  });

  test('planner reports deterministic fallback when interpretation is unavailable', async () => {
    const instructorProgram = makeProgram('Fallback hill');
    instructorProgram.segments[0] = {
      ...instructorProgram.segments[0]!,
      label: 'Climb Z4 60 standing',
    };
    await services.storage.saveTrack(track);
    await services.storage.saveAnalysis(makeAnalysis());
    await services.storage.saveProgram(instructorProgram);
    services.fake.state.failWorkoutInterpretation = true;
    const root = await start('#/planner');
    await setValue(
      root.querySelector<HTMLTextAreaElement>('textarea')!,
      'One hard Z4 climb.',
      'input',
    );
    await until(
      () => root.textContent ?? '',
      (text) => /Build from my Programs/.test(text),
    );
    await click(button(root, 'Build from my Programs'));
    await until(
      () => root.textContent ?? '',
      (text) => /no successful model call/.test(text),
    );
    expect(root.textContent).toMatch(/Fallback hill/);
  });
});

const inputOf = (root: ParentNode, text: RegExp) =>
  [...root.querySelectorAll('label')]
    .find((l) => text.test(l.textContent ?? ''))!
    .querySelector('input') as HTMLInputElement;

describe('settings', () => {
  test('the theme choice is applied, saved, and applied again after a reload', async () => {
    const root = await start('#/settings');
    await click(inputOf(root, /^\s*Dark\s*$/));
    await until(
      () => document.documentElement.getAttribute('data-theme'),
      (v) => v === 'dark',
    );
    expect(await services.storage.getSetting('theme', 'system')).toBe('dark');

    await view?.destroy();
    document.documentElement.removeAttribute('data-theme');
    await start('#/');
    await until(
      () => document.documentElement.getAttribute('data-theme'),
      (v) => v === 'dark',
    );
    document.documentElement.removeAttribute('data-theme');
  });

  test('the glitch setting is saved', async () => {
    const root = await start('#/settings');
    await click(inputOf(root, /glitch/));
    await until(
      () => services.storage.getSetting('glitch', false),
      (v) => v === true,
    );
  });
});
