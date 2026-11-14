<script lang="ts">
  import { onMount } from 'svelte';
  import { programFromAnalysis } from '@grade/core';
  import { describeError } from './errors';
  import { hrefs } from './router';
  import type { Services } from './services';

  interface Props {
    services: Services;
    jobId: string;
    trackId: string;
    ondone: (programId: string) => void;
  }
  let { services, jobId, trackId, ondone }: Props = $props();

  let progress = $state(0);
  let error = $state('');

  onMount(() => {
    const abort = new AbortController();
    (async () => {
      try {
        await services.api.waitForJob(jobId, (p) => (progress = p), { signal: abort.signal });
        const [track, analysis] = await Promise.all([
          services.api.getTrack(trackId),
          services.api.getAnalysis(trackId),
        ]);
        await services.storage.saveTrack(track);
        await services.storage.saveAnalysis(analysis);
        const program = programFromAnalysis(
          analysis,
          { name: track.title, now: services.now() },
          { newId: services.newId },
        );
        await services.storage.saveProgram(program);
        ondone(program.id);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        error = describeError(err);
      }
    })();
    return () => abort.abort();
  });
</script>

<main>
  <h1>Analyzing the song</h1>
  {#if error}
    <div class="banner error" role="alert">{error}</div>
    <a href={hrefs.import()}><button type="button" class="primary">Try another song</button></a>
  {:else}
    <p class="muted">This takes up to a minute. Keep this page open.</p>
    <progress value={progress} max="1" aria-label="Analysis progress"></progress>
    <p role="status">{Math.round(progress * 100)}%</p>
  {/if}
</main>

<style>
  a {
    text-decoration: none;
  }
</style>
