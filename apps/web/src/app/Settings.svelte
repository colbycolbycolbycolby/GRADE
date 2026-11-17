<script lang="ts">
  import { onMount } from 'svelte';
  import { describeError } from './errors';
  import { hrefs } from './router';
  import { applyTheme, loadGlitch, loadTheme, THEMES, type Theme } from './settings';
  import type { Services } from './services';

  interface Props {
    services: Services;
  }
  let { services }: Props = $props();

  const themeLabel: Record<Theme, string> = {
    system: 'Same as the device',
    light: 'Light',
    dark: 'Dark',
  };

  let theme: Theme = $state('system');
  let glitch = $state(false);
  let error = $state('');

  onMount(async () => {
    try {
      theme = await loadTheme(services.storage);
      glitch = await loadGlitch(services.storage);
    } catch (err) {
      error = describeError(err);
    }
  });

  async function setTheme(next: Theme) {
    theme = next;
    applyTheme(next);
    error = '';
    try {
      await services.storage.setSetting('theme', next);
    } catch (err) {
      error = describeError(err);
    }
  }

  async function setGlitch(event: Event) {
    glitch = (event.currentTarget as HTMLInputElement).checked;
    error = '';
    try {
      await services.storage.setSetting('glitch', glitch);
    } catch (err) {
      error = describeError(err);
    }
  }
</script>

<main>
  <a href={hrefs.library()}>&larr; Library</a>
  <h1>Settings</h1>
  {#if error}<div class="banner error" role="alert">{error}</div>{/if}

  <fieldset>
    <legend>Theme</legend>
    {#each THEMES as option (option)}
      <label class="choice">
        <input
          type="radio"
          name="theme"
          value={option}
          checked={theme === option}
          onchange={() => setTheme(option)}
        />
        {themeLabel[option]}
      </label>
    {/each}
  </fieldset>

  <fieldset>
    <legend>Transition effect</legend>
    <label class="choice">
      <input type="checkbox" checked={glitch} onchange={setGlitch} />
      Play the glitch sound before each cut
    </label>
    <p class="muted">
      The effect needs the local audio player. It has no effect on songs that play from YouTube.
    </p>
  </fieldset>

  <p class="build-id muted">Development build <code>{__GRADE_BUILD_ID__}</code></p>
</main>

<style>
  fieldset {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin: 12px 0;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--tap);
  }
  .choice input {
    width: 20px;
    height: 20px;
  }
  a {
    text-decoration: none;
  }
  .build-id {
    margin-top: 28px;
    font-size: 0.78rem;
  }
</style>
