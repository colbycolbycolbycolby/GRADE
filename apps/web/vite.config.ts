import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { execFileSync } from 'node:child_process';

function buildId(): string {
  if (process.env.GRADE_BUILD_ID) return process.env.GRADE_BUILD_ID;
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'development';
  }
}

export default defineConfig({
  define: { __GRADE_BUILD_ID__: JSON.stringify(buildId()) },
  plugins: [
    svelte(),
    // The service worker caches the app shell only. It never touches `/api`, so audio and Range
    // requests always go to the server. It is off in tests.
    !process.env.VITEST &&
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          name: 'GRADE',
          short_name: 'GRADE',
          description: 'Plan the music of a cycling class.',
          start_url: '.',
          display: 'standalone',
          background_color: '#121314',
          theme_color: '#121314',
          icons: [
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg}'],
          navigateFallbackDenylist: [/^\/api\//],
        },
      }),
  ],
  // Send API calls to the local server while developing: `uv run uvicorn api.app:create_app --factory`.
  server: { proxy: { '/api': process.env.GRADE_API_PROXY ?? 'http://127.0.0.1:8000' } },
  // Svelte components must resolve to the browser build in tests.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  test: { environment: 'node', setupFiles: ['./src/testing/setup.ts'] },
});
