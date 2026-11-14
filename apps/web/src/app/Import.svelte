<script lang="ts">
  import { describeError } from './errors';
  import { hrefs } from './router';
  import type { Services } from './services';

  interface Props {
    services: Services;
    onstarted: (jobId: string, trackId: string) => void;
  }
  let { services, onstarted }: Props = $props();

  let mode: 'youtube' | 'file' = $state('youtube');
  let url = $state('');
  let file: File | null = $state(null);
  let busy = $state(false);
  let error = $state('');

  const ready = $derived(mode === 'youtube' ? url.trim() !== '' : file !== null);

  async function submit(event: Event) {
    event.preventDefault();
    if (!ready || busy) return;
    busy = true;
    error = '';
    try {
      const res =
        mode === 'youtube'
          ? await services.api.ingestYoutube(url.trim())
          : await services.api.ingestFile(file!);
      onstarted(res.jobId, res.trackId);
    } catch (err) {
      error = describeError(err);
    } finally {
      busy = false;
    }
  }
</script>

<main>
  <a href={hrefs.library()}>&larr; Library</a>
  <h1>New program</h1>

  <form class="card" onsubmit={submit}>
    <fieldset class="row">
      <legend class="muted">Song source</legend>
      <label><input type="radio" bind:group={mode} value="youtube" /> YouTube link</label>
      <label><input type="radio" bind:group={mode} value="file" /> Audio file</label>
    </fieldset>

    {#if mode === 'youtube'}
      <label class="field">
        YouTube link
        <input
          type="url"
          bind:value={url}
          placeholder="https://www.youtube.com/watch?v=..."
          autocomplete="off"
        />
      </label>
    {:else}
      <label class="field">
        Audio file
        <input
          type="file"
          accept="audio/*"
          onchange={(e) => (file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)}
        />
      </label>
    {/if}

    {#if error}<div class="banner error" role="alert">{error}</div>{/if}

    <button type="submit" class="primary" disabled={!ready || busy}>
      {busy ? 'Starting…' : 'Analyze song'}
    </button>
  </form>
</main>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0 0 12px;
  }
  a {
    text-decoration: none;
  }
</style>
