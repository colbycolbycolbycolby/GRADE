<script lang="ts">
  import { onMount } from 'svelte';
  import type { Analysis, Program, Track } from '@grade/schema';
  import Editor from '../editor/Editor.svelte';
  import { describeError } from './errors';
  import { ensureTrackData } from './programFiles';
  import { hrefs } from './router';
  import type { Services } from './services';

  interface Props {
    services: Services;
    id: string;
  }
  let { services, id }: Props = $props();

  // Raw state: IndexedDB cannot clone the proxies that deep state makes.
  let loaded = $state.raw<{ program: Program; analysis: Analysis; track: Track } | null>(null);
  let error = $state('');

  onMount(async () => {
    try {
      const program = await services.storage.getProgram(id);
      if (!program) {
        error = 'This program does not exist.';
        return;
      }
      await ensureTrackData(services, program.trackId);
      const [track, analysis] = await Promise.all([
        services.storage.getTrack(program.trackId),
        services.storage.getAnalysis(program.trackId),
      ]);
      if (!track || !analysis) {
        error = 'The song data for this program is missing.';
        return;
      }
      loaded = { program, analysis, track };
    } catch (err) {
      error = describeError(err);
    }
  });
</script>

{#if loaded}
  <Editor {...loaded} {services} />
{:else if error}
  <main>
    <div class="banner error" role="alert">{error}</div>
    <a href={hrefs.library()}>&larr; Library</a>
  </main>
{:else}
  <main><p class="muted">Loading&hellip;</p></main>
{/if}
