// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { segmentTitle } from '@grade/core';
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
import Editor from './Editor.svelte';

let services: TestServices;
let view: Mounted | undefined;

async function open(program = makeProgram()) {
  await services.storage.saveProgram(program);
  const mounted = render(Editor, { program, analysis: makeAnalysis(), track, services });
  view = mounted;
  await settle();
  return mounted.target;
}

const saved = () => services.storage.getProgram('p1');

beforeEach(() => {
  document.body.innerHTML = '';
  services = makeServices();
});
afterEach(async () => {
  await view?.destroy();
  view = undefined;
});

describe('Editor', () => {
  test('shows section numbers in a row below the waveform, with the tier as text', async () => {
    const root = await open();
    const labels = root.querySelectorAll('.labels .label');
    expect([...labels].map((l) => l.querySelector('.name')?.textContent)).toEqual([
      'Section 1',
      'Section 2',
      'Section 3',
      'Section 4',
    ]);
    expect(labels[0]!.textContent).toMatch(/Easy/);
    expect(root.querySelector('.plot')!.contains(labels[0]!)).toBe(false);
  });

  test('picking a section selects it', async () => {
    const root = await open();
    await click(root.querySelectorAll<HTMLElement>('.labels .label')[2]!);
    expect(root.querySelector('[aria-label="Selected section"] h2')?.textContent).toBe('Section 3');
  });

  test('clicking a section directly on the waveform selects it and seeks there', async () => {
    const root = await open();
    const hit = byLabel<HTMLElement>(root, 'Select Section 3 on waveform');
    hit.parentElement!.getBoundingClientRect = () =>
      ({ left: 0, width: 600, right: 600, top: 0, bottom: 120, height: 120 }) as DOMRect;
    hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 350 }));
    await settle();
    expect(root.querySelector('[aria-label="Selected section"] h2')?.textContent).toBe('Section 3');
    expect(hit.getAttribute('aria-pressed')).toBe('true');
  });

  test('the tier picker changes the tier and saves it', async () => {
    const root = await open();
    const picker = byLabel(root, 'Intensity');
    await click(button(picker, 'All out'));
    expect(button(picker, 'All out').getAttribute('aria-pressed')).toBe('true');
    const p = await until(saved, (x) => x?.segments[0]?.tier === 'allout');
    expect(p!.segments[0]!.tier).toBe('allout');
  });

  test('rename sets the label, and the list offers labels already used', async () => {
    const root = await open();
    await setValue(byLabel<HTMLInputElement>(root, 'Section name'), 'Hill');
    expect(root.querySelector('.labels .label .name')?.textContent).toBe('Hill');
    await click(button(root, 'Reuse a title'));
    expect(button(root, 'Hill')).toBeTruthy();
    const p = await until(saved, (x) => x?.segments[0]?.label === 'Hill');
    expect(segmentTitle(p!, p!.segments[1]!)).toBe('Section 2');
  });

  test('split uses the section under the playhead without selecting it first', async () => {
    const root = await open();
    const split = byLabel<HTMLButtonElement>(root, 'Split section at playhead');
    expect(split.disabled).toBe(true); // the playhead is at 0
    await setValue(byLabel<HTMLInputElement>(root, 'Scrub'), '70', 'input');
    expect(split.disabled).toBe(false);
    await click(split);
    expect(root.querySelectorAll('.labels .label')).toHaveLength(5);
    const p = await until(saved, (x) => x?.segments.length === 5);
    expect(p!.segments[3]!.start).toBe(70);
    expect(root.querySelector('[aria-label="Selected section"] h2')?.textContent).toBe('Section 1');
  });

  test('merge and delete remove sections and explain the runner boundary update', async () => {
    const root = await open();
    await click(root.querySelectorAll<HTMLElement>('.labels .label')[1]!);
    await click(button(root, 'Merge into previous'));
    expect(root.querySelectorAll('.labels .label')).toHaveLength(3);
    await click(button(root, 'Delete section'));
    expect(root.querySelectorAll('.labels .label')).toHaveLength(2);
    expect(root.querySelector('.banner[role="status"]')?.textContent).toMatch(
      /countdowns follow.*waveform boundaries/i,
    );
  });

  test('undo and redo', async () => {
    const root = await open();
    const undo = button(root, 'Undo');
    expect(undo.disabled).toBe(true);
    await click(button(byLabel(root, 'Intensity'), 'Hard'));
    expect(undo.disabled).toBe(false);
    await click(undo);
    expect(button(byLabel(root, 'Intensity'), 'Hard').getAttribute('aria-pressed')).toBe('false');
    await click(button(root, 'Redo'));
    expect(button(byLabel(root, 'Intensity'), 'Hard').getAttribute('aria-pressed')).toBe('true');
  });

  test('desktop shortcuts move the playhead, adjust a boundary, and undo/redo edits', async () => {
    const root = await open();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await settle();
    expect(byLabel<HTMLInputElement>(root, 'Scrub').value).toBe('0.5');

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }),
    );
    await until(saved, (x) => x?.segments[0]?.end === 30.5);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
    await until(saved, (x) => x?.segments[0]?.end === 30);
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true, bubbles: true }),
    );
    await until(saved, (x) => x?.segments[0]?.end === 30.5);
  });

  test('editor shortcuts do not interfere with text entry', async () => {
    const root = await open();
    const name = byLabel<HTMLInputElement>(root, 'Section name');
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
    await settle();
    expect(byLabel<HTMLInputElement>(root, 'Scrub').value).toBe('0');
    expect(button(root, 'Undo').disabled).toBe(true);
  });

  test('the reusable-title menu stays anchored to the name field', async () => {
    const program = makeProgram();
    program.segments[1] = { ...program.segments[1]!, label: 'Climb' };
    const root = await open(program);
    await click(button(root, 'Reuse a title'));
    const menu = root.querySelector<HTMLElement>('.title-menu')!;
    expect(menu.parentElement?.classList.contains('name-field')).toBe(true);
    await click(button(menu, 'Climb'));
    const p = await until(saved, (x) => x?.segments[0]?.label === 'Climb');
    expect(p!.segments[0]!.label).toBe('Climb');
  });

  test('a boundary moves with the keyboard, and not below the minimum section length', async () => {
    const root = await open();
    const divider = root.querySelector<HTMLElement>('.divider')!;
    divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await settle();
    const p = await until(saved, (x) => x?.segments[0]?.end === 30.5);
    expect(p!.segments[1]!.start).toBe(30.5);
    expect(divider.getAttribute('aria-valuenow')).toBe('30.5');
  });

  test('the interval form replaces the song after the playhead', async () => {
    const root = await open();
    await setValue(byLabel<HTMLInputElement>(root, 'Scrub'), '60', 'input');
    await click(button(root, 'Make intervals'));
    const p = await until(saved, (x) => (x?.segments.length ?? 0) > 4);
    expect(p!.segments.filter((s) => s.label === 'All out').length).toBeGreaterThan(1);
  });

  test('rename the program', async () => {
    const root = await open();
    await setValue(byLabel<HTMLInputElement>(root, 'Program name'), 'Tuesday Hills');
    await until(saved, (x) => x?.name === 'Tuesday Hills');
  });

  test('program tags normalize, deduplicate, remove, and persist with workout format', async () => {
    const root = await open();
    await setValue(byLabel<HTMLInputElement>(root, 'Add tag'), ' 100 RPM   Sprint ', 'input');
    await click(button(root, 'Add tag'));
    await setValue(byLabel<HTMLInputElement>(root, 'Add tag'), '100 rpm sprint', 'input');
    await click(button(root, 'Add tag'));
    await setValue(byLabel<HTMLSelectElement>(root, 'Workout format'), 'sprint');
    let program = await until(saved, (value) => value?.workoutFormat === 'sprint');
    expect(program!.tags).toEqual(['100_rpm_sprint']);
    await click(byLabel(root, 'Remove tag 100_rpm_sprint'));
    program = await until(saved, (value) => value?.tags?.length === 0);
    expect(program!.tags).toEqual([]);
  });

  test('recognized title fields are shown and manual corrections persist without changing title', async () => {
    const program = makeProgram();
    program.segments[0] = { ...program.segments[0]!, label: 'Z4 70-80 Standing' };
    const root = await open(program);
    expect(byLabel<HTMLSelectElement>(root, 'Resistance zone').value).toBe('4');
    expect(byLabel<HTMLInputElement>(root, 'Cadence minimum RPM').value).toBe('70');
    expect(byLabel<HTMLInputElement>(root, 'Cadence maximum RPM').value).toBe('80');
    expect(byLabel<HTMLSelectElement>(root, 'Position').value).toBe('standing');
    await setValue(byLabel<HTMLSelectElement>(root, 'Resistance zone'), '3');
    const savedProgram = await until(saved, (value) => value?.segments[0]?.resistanceZone === 3);
    expect(savedProgram!.segments[0]!.label).toBe('Z4 70-80 Standing');
    expect(savedProgram!.segments[0]!.start).toBe(0);
    expect(savedProgram!.segments[0]!.end).toBe(30);
  });

  test('editing a shorthand title immediately prefills empty workout fields', async () => {
    const root = await open();
    await setValue(byLabel<HTMLInputElement>(root, 'Section name'), 'Z3 80 Seated');
    expect(byLabel<HTMLSelectElement>(root, 'Resistance zone').value).toBe('3');
    expect(byLabel<HTMLInputElement>(root, 'Cadence minimum RPM').value).toBe('80');
    expect(byLabel<HTMLSelectElement>(root, 'Position').value).toBe('seated');
    const savedProgram = await until(saved, (value) => value?.segments[0]?.resistanceZone === 3);
    expect(savedProgram!.segments[0]).toMatchObject({
      label: 'Z3 80 Seated',
      cadence: { minRpm: 80 },
      position: 'seated',
    });
  });

  test('export hands a valid program file to the download service', async () => {
    const root = await open();
    await click(button(root, 'Export'));
    expect(services.downloads).toHaveLength(1);
    expect(services.downloads[0]!.filename).toBe('Test_Song.grade.json');
    expect(JSON.parse(services.downloads[0]!.text).program.id).toBe('p1');
  });

  test('play starts the backend at the playhead in file time (crop offset)', async () => {
    const root = await open();
    await setValue(byLabel<HTMLInputElement>(root, 'Scrub'), '10', 'input');
    await until(
      () => services.backends[0]!.seeks,
      (s) => s.length > 0,
    );
    await click(button(root, 'Play'));
    await until(
      () => services.backends[0]!.playing,
      (p) => p,
    );
    // The analysis crops 2 s, so playhead 10 is file time 12.
    expect(services.backends[0]!.seeks.at(-1)).toBe(12);
    expect(button(root, 'Pause')).toBeTruthy();
  });

  test('a save failure shows a message', async () => {
    const root = await open();
    services.storage.saveProgram = async () => {
      throw new Error('Could not save the program.');
    };
    await click(button(byLabel(root, 'Intensity'), 'Hard'));
    await until(
      () => root.querySelector('.banner.error')?.textContent ?? '',
      (t) => /Could not save/.test(t),
    );
  });
});

describe('Editor pointer drags', () => {
  const pointer = (type: string, clientX: number) =>
    new PointerEvent(type, { bubbles: true, clientX, pointerId: 1 });
  const rect = (width: number) => () =>
    ({ left: 0, top: 0, right: width, bottom: 10, width, height: 10, x: 0, y: 0 }) as DOMRect;

  test('dragging a divider commits one move on release', async () => {
    const root = await open();
    const divider = root.querySelector<HTMLElement>('.divider')!;
    divider.parentElement!.getBoundingClientRect = rect(600); // 120 s over 600 px: 5 px per second
    divider.dispatchEvent(pointer('pointerdown', 150));
    divider.dispatchEvent(pointer('pointermove', 125)); // 25 s
    divider.dispatchEvent(pointer('pointermove', 100)); // 20 s
    await settle();
    expect(divider.classList.contains('dragging')).toBe(true);
    divider.dispatchEvent(pointer('pointerup', 100));
    await settle();
    const p = await until(saved, (x) => x?.segments[0]?.end === 20);
    expect(p!.segments[1]!.start).toBe(20);
    expect(button(root, 'Undo').disabled).toBe(false);
    await click(button(root, 'Undo')); // one drag is one undo step
    expect(button(root, 'Undo').disabled).toBe(true);
  });

  test('a divider cannot be dragged past the minimum section length', async () => {
    const root = await open();
    const divider = root.querySelector<HTMLElement>('.divider')!;
    divider.parentElement!.getBoundingClientRect = rect(600);
    divider.dispatchEvent(pointer('pointerdown', 150));
    divider.dispatchEvent(pointer('pointermove', 1));
    divider.dispatchEvent(pointer('pointerup', 1));
    await settle();
    await until(saved, (x) => x?.segments[0]?.end === 2);
  });
});
