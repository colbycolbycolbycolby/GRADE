import { flushSync, mount, tick, unmount } from 'svelte';
import type { Component } from 'svelte';
import { vi } from 'vitest';

export interface Mounted {
  target: HTMLElement;
  destroy: () => Promise<void>;
}

export function render<P extends object>(component: Component<P>, props: P): Mounted {
  const target = document.createElement('div');
  document.body.append(target);
  const instance = mount(component, { target, props });
  flushSync();
  return {
    target,
    destroy: async () => {
      await unmount(instance);
      target.remove();
    },
  };
}

export const settle = async () => {
  await tick();
  flushSync();
};

export function byLabel<T extends HTMLElement = HTMLElement>(root: ParentNode, label: string): T {
  const el = root.querySelector<T>(`[aria-label="${label}"]`);
  if (!el) throw new Error(`No element with aria-label "${label}"`);
  return el;
}

export function button(root: ParentNode, text: string | RegExp): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((b) =>
    typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent ?? ''),
  );
  if (!found) throw new Error(`No button "${text}"`);
  return found as HTMLButtonElement;
}

export async function click(el: HTMLElement): Promise<void> {
  el.click();
  await settle();
}

export async function setValue(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
  event = 'change',
) {
  el.value = value;
  el.dispatchEvent(new Event(event, { bubbles: true }));
  await settle();
}

/** Waits for a condition that depends on async work such as IndexedDB. */
export async function until<T>(read: () => T | Promise<T>, ok: (v: T) => boolean): Promise<T> {
  let last!: T;
  await vi.waitFor(
    async () => {
      last = await read();
      if (!ok(last)) throw new Error('not yet');
    },
    { timeout: 2000, interval: 20 },
  );
  return last;
}
