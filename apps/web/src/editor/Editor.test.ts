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
    const options = [...root.querySelectorAll('datalist option')].map((o) =>
      o.getAttribute('value'),
    );
    expect(options).toContain('Hill');
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

  test('merge and delete remove sections, and the user is told about the class order', async () => {
    const root = await open();
    await click(root.querySelectorAll<HTMLElement>('.labels .label')[1]!);
    await click(button(root, 'Merge into previous'));
    expect(root.querySelectorAll('.labels .label')).toHaveLength(3);
    await click(button(root, 'Delete section'));
    expect(root.querySelectorAll('.labels .label')).toHaveLength(2);
    expect(root.querySelector('.banner[role="status"]')?.textContent).toMatch(
      /Class order changed/,
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

  test('the block list repeats, reorders and removes blocks from the order', async () => {
    const root = await open();
    await click(byLabel(root, 'Repeat block 1'));
    expect(root.querySelectorAll('.block')).toHaveLength(5);
    await click(byLabel(root, 'Move block 1 later'));
    const titles = [...root.querySelectorAll('.block strong')].map((e) => e.textContent);
    expect(titles[0]).toBe('1. Section 1');
    await click(byLabel(root, 'Remove block 2 from the class order'));
    expect(root.querySelectorAll('.block')).toHaveLength(4);
    await until(saved, (x) => x?.clips.length === 4);
  });

  test('the last block cannot be removed from the order', async () => {
    const program = makeProgram();
    const one = { ...program, clips: [program.clips[0]!] };
    const root = await open(one);
    expect(byLabel<HTMLButtonElement>(root, 'Remove block 1 from the class order').disabled).toBe(
      true,
    );
  });

  test('select several blocks, then repeat them as a group', async () => {
    const root = await open();
    await click(byLabel(root, 'Select block 1'));
    await click(byLabel(root, 'Select block 3'));
    expect(root.querySelector('[aria-label="Selected blocks"]')?.textContent).toMatch(/2 selected/);
    await click(button(root, 'Repeat selected'));
    expect(root.querySelectorAll('.block')).toHaveLength(6);
    expect(root.querySelector('[aria-label="Selected blocks"]')).toBeNull();
  });

  test('drag a tile to the end of the strip to reorder', async () => {
    const program = makeProgram();
    const root = await open(program);
    const strip = root.querySelector<HTMLElement>('.strip')!;
    const tiles = strip.querySelectorAll<HTMLElement>('[data-tile]');
    tiles[0]!.dispatchEvent(new Event('dragstart', { bubbles: true }));
    strip.dispatchEvent(
      new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX: 999 }),
    );
    strip.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    await settle();
    const first = (await until(saved, (x) => x?.clips[3]?.id === program.clips[0]!.id))!;
    expect(first.clips[3]!.id).toBe(program.clips[0]!.id);
  });

  test('drop a tile on the repeat and remove zones', async () => {
    const root = await open();
    const tile = () => root.querySelectorAll<HTMLElement>('[data-tile]')[1]!;
    tile().dispatchEvent(new Event('dragstart', { bubbles: true }));
    byLabel(root, 'Drop here to repeat').dispatchEvent(
      new Event('drop', { bubbles: true, cancelable: true }),
    );
    await settle();
    expect(root.querySelectorAll('[data-tile]')).toHaveLength(5);
    tile().dispatchEvent(new Event('dragstart', { bubbles: true }));
    byLabel(root, 'Drop here to remove from the class order').dispatchEvent(
      new Event('drop', { bubbles: true, cancelable: true }),
    );
    await settle();
    expect(root.querySelectorAll('[data-tile]')).toHaveLength(4);
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

  test('dragging the end edge of a tile trims the clip', async () => {
    const root = await open();
    const tile = root.querySelector<HTMLElement>('[data-tile]')!;
    tile.getBoundingClientRect = rect(120); // 30 s over 120 px: 0.25 s per px
    const edge = tile.querySelector<HTMLElement>('.edge.end')!;
    edge.dispatchEvent(pointer('pointerdown', 100));
    edge.dispatchEvent(pointer('pointermove', 60)); // 40 px left = 10 s
    edge.dispatchEvent(pointer('pointerup', 60));
    await settle();
    const p = await until(saved, (x) => x?.clips[0]?.end === 20);
    expect(p!.clips[0]!.start).toBe(0);
  });

  test('dragging the start edge trims from the front, never below 1 s', async () => {
    const root = await open();
    const tile = root.querySelector<HTMLElement>('[data-tile]')!;
    tile.getBoundingClientRect = rect(120);
    const edge = tile.querySelector<HTMLElement>('.edge.start')!;
    edge.dispatchEvent(pointer('pointerdown', 0));
    edge.dispatchEvent(pointer('pointermove', 5000));
    edge.dispatchEvent(pointer('pointerup', 5000));
    await settle();
    await until(saved, (x) => x?.clips[0]?.start === 29);
  });
});
