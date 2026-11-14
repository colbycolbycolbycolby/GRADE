// @vitest-environment jsdom
import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { item } from '../playback/testkit';
import { button, click, render, type Mounted } from '../testing/dom';
import RunnerView from './RunnerView.svelte';

let view: Mounted | undefined;
afterEach(async () => {
  await view?.destroy();
  view = undefined;
});

function mount(over: Record<string, unknown> = {}) {
  const calls = {
    onplaypause: vi.fn(),
    onskip: vi.fn(),
    onnext: vi.fn(),
    onend: vi.fn(),
  };
  const props = {
    tier: 'hard',
    title: 'Section 2',
    songTitle: 'Test Song',
    songIndex: 0,
    songCount: 1,
    blockRemaining: 24.2,
    upcoming: [item(1, 30, 30, 60, 'allout'), item(2, 60, 60, 90, 'easy')],
    playing: true,
    waitingForSong: false,
    classTime: 5,
    classTotal: 120,
    energy: [],
    boundaries: [30, 60],
    pulse: 0.5,
    keepAwake: 'held',
    notice: '',
    ...calls,
    ...over,
  } as ComponentProps<typeof RunnerView>;
  view = render(RunnerView, props);
  return { root: view.target, calls };
}

describe('RunnerView', () => {
  test('shows the cue, the tier name, the title and the countdown rounded up', () => {
    const { root } = mount();
    expect(root.querySelector('.cue')!.textContent).toBe('Push');
    expect(root.querySelector('.tier')!.textContent).toBe('Hard');
    expect(root.querySelector('h1')!.textContent).toBe('Section 2');
    expect(root.querySelector('[role="timer"]')!.textContent!.trim()).toBe('0:25');
    expect(root.querySelector('.runner')!.getAttribute('data-tier')).toBe('hard');
  });

  test('lists the blocks that come up, with the tier as text', () => {
    const { root } = mount();
    const rows = [...root.querySelectorAll('li')].map((li) =>
      li.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(rows).toEqual(['Block 1 All out 0:30', 'Block 2 Easy 0:30']);
  });

  test.each([
    ['easy', 'Ease up'],
    ['moderate', 'Building'],
    ['hard', 'Push'],
    ['allout', 'All out'],
  ])('the %s tier shows "%s"', (tier, cue) => {
    const { root } = mount({ tier });
    expect(root.querySelector('.cue')!.textContent).toBe(cue);
  });

  test('buttons call back', async () => {
    const { root, calls } = mount({ songCount: 3, songIndex: 1 });
    await click(button(root, /^Pause$/));
    await click(button(root, /10 s$/).parentElement!.querySelectorAll('button')[0]!);
    await click(root.querySelector<HTMLButtonElement>('[aria-label="Forward 10 seconds"]')!);
    await click(button(root, 'Next song'));
    expect(calls.onplaypause).toHaveBeenCalledOnce();
    expect(calls.onskip.mock.calls).toEqual([[-10], [10]]);
    expect(calls.onnext).toHaveBeenCalledOnce();
  });

  test('End class needs a second tap', async () => {
    const { root, calls } = mount();
    await click(button(root, 'End class'));
    expect(calls.onend).not.toHaveBeenCalled();
    await click(button(root, 'Tap again to end'));
    expect(calls.onend).toHaveBeenCalledOnce();
  });

  test('a single song has no next-song button, and the last song of a plan says Finish', () => {
    expect(() => button(mount().root, 'Next song')).toThrow();
    const { root } = mount({ songCount: 2, songIndex: 1 });
    expect(button(root, 'Finish class')).toBeTruthy();
    expect(root.querySelector('.top')!.textContent).toMatch(/Song 2 of 2/);
  });

  test('it warns when the screen lock is not held', () => {
    expect(mount({ keepAwake: 'unsupported' }).root.textContent).toMatch(
      /cannot keep the screen on/,
    );
  });

  test('it shows a notice, and a wait message between songs', () => {
    const { root } = mount({ notice: 'The audio stopped.', waitingForSong: true });
    expect(root.querySelector('[role="alert"]')!.textContent).toBe('The audio stopped.');
    expect(root.querySelector('[role="status"]')!.textContent).toMatch(/Loading next song/);
    expect(root.querySelector('[role="timer"]')).toBeNull();
  });

  test('the pulse is a style variable on the root, which isolates its stacking context', () => {
    const { root } = mount({ pulse: 0.8 });
    expect(root.querySelector<HTMLElement>('.runner')!.style.getPropertyValue('--pulse')).toBe(
      '0.8',
    );
  });
});
