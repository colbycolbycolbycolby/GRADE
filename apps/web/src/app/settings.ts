import type { Storage } from '../storage/storage';

export type Theme = 'system' | 'light' | 'dark';

export const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

/** Reads the saved theme. New installs start with GRADE's dark identity. */
export async function loadTheme(storage: Storage): Promise<Theme> {
  const value = await storage.getSetting<unknown>('theme', 'dark');
  return THEMES.includes(value as Theme) ? (value as Theme) : 'dark';
}

/** `system` removes the attribute, so `prefers-color-scheme` decides (see app.css). */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export async function loadGlitch(storage: Storage): Promise<boolean> {
  return (await storage.getSetting<unknown>('glitch', false)) === true;
}
