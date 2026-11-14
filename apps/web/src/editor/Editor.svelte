<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { MIN_SEGMENT_SEC, segmentTitle } from '@grade/core';
  import type { Analysis, Program, Track } from '@grade/schema';
  import { exportProgram } from '../app/programFiles';
  import type { Services } from '../app/services';
  import { hrefs } from '../app/router';
  import { OffsetBackend, type PlaybackBackend } from '../playback';
  import BlockList from './BlockList.svelte';
  import ClassStrip from './ClassStrip.svelte';
  import { formatTime } from './geometry';
  import IntervalForm from './IntervalForm.svelte';
  import { canRedoState, canUndoState, usedLabels } from './model';
  import { EditorStore } from './store.svelte';
  import { TIER_LABEL, TIER_LIST } from './tiers';
  import Waveform from './Waveform.svelte';

  interface Props {
    program: Program;
    analysis: Analysis;
    track: Track;
    services: Services;
  }
  let { program: initial, analysis, track, services }: Props = $props();

  // The editor keeps its own copy of the program. Props are read once, on purpose.
  // svelte-ignore state_referenced_locally
  const store = new EditorStore(initial, { now: services.now, newId: services.newId }, (p) =>
    services.storage.saveProgram(p),
  );
  const uid = $props.id();

  const program = $derived(store.program);
  const duration = $derived(program.segments[program.segments.length - 1]!.end);
  const ed = $derived(store.state);
  const selected = $derived(program.segments.find((s) => s.id === ed.selectedSegmentId));
  const selectedIndex = $derived(program.segments.findIndex((s) => s.id === ed.selectedSegmentId));
  /** Energy in crop-relative time. */
  const energy = $derived(
    analysis.energy
      .filter((p) => p.t >= analysis.cropStart && p.t <= analysis.cropEnd)
      .map((p) => ({ t: p.t - analysis.cropStart, e: p.e })),
  );

  let backend: PlaybackBackend | null = null;
  let playing = $state(false);
  let audioReady = $state(false);
  let audioError = $state('');
  let off: (() => void)[] = [];

  onMount(() => {
    const inner = new OffsetBackend(services.createBackend(), analysis.cropStart);
    backend = inner;
    off.push(
      inner.onPosition((t) => {
        if (playing) store.dispatch({ type: 'set-playhead', t: Math.min(t, duration) });
      }),
      inner.onEnded(() => (playing = false)),
    );
    inner
      .load({ id: track.id, url: services.api.audioUrl(track.id) })
      .then(() => (audioReady = true))
      .catch(() => (audioError = 'The audio could not load. You can still edit.'));
  });

  onDestroy(() => {
    for (const fn of off) fn();
    backend?.dispose();
    void store.flush();
  });

  async function togglePlay() {
    if (!backend || !audioReady) return;
    if (playing) {
      backend.pause();
      playing = false;
    } else {
      await backend.seek(ed.playhead);
      await backend.play();
      playing = true;
    }
  }

  function seek(t: number) {
    store.dispatch({ type: 'set-playhead', t });
    void backend?.seek(t);
  }

  function pickSegment(id: string) {
    store.dispatch({ type: 'select-segment', id });
  }

  /** Saves first, so the runner loads the program with the latest edit. */
  async function startClass(event: MouseEvent) {
    event.preventDefault();
    await store.flush();
    location.hash = hrefs.run('program', program.id);
  }

  function doExport() {
    const file = exportProgram(program);
    services.download(file.filename, file.text);
  }

  const canSplitSelected = $derived(
    !!selected &&
      ed.playhead - selected.start >= MIN_SEGMENT_SEC &&
      selected.end - ed.playhead >= MIN_SEGMENT_SEC,
  );
</script>

<main>
  <div class="row top">
    <a class="back" href={hrefs.library()}>&larr; Library</a>
    <span class="track-title">{track.title}</span>
    <span class="muted" role="status">
      {#if store.saveStatus === 'saving'}Saving&hellip;{:else if store.saveStatus === 'saved'}Saved{:else}Not
        saved{/if}
    </span>
  </div>

  <div class="row">
    <label class="grow">
      <span class="muted">Program name</span>
      <input
        type="text"
        value={program.name}
        aria-label="Program name"
        onchange={(e) =>
          store.dispatch({
            type: 'rename-program',
            name: (e.currentTarget as HTMLInputElement).value,
          })}
      />
    </label>
    <button
      type="button"
      disabled={!canUndoState(ed)}
      onclick={() => store.dispatch({ type: 'undo' })}
    >
      Undo
    </button>
    <button
      type="button"
      disabled={!canRedoState(ed)}
      onclick={() => store.dispatch({ type: 'redo' })}
    >
      Redo
    </button>
    <button type="button" onclick={doExport}>Export</button>
    <a class="button primary" href={hrefs.run('program', program.id)} onclick={startClass}>
      Start class
    </a>
  </div>

  {#if store.saveStatus === 'error'}
    <div class="banner error" role="alert">{store.saveError}</div>
  {/if}
  {#if audioError}
    <div class="banner error" role="alert">{audioError}</div>
  {/if}
  {#if ed.notice}
    <div class="banner" class:error={ed.notice.kind === 'error'} role="status">
      {ed.notice.text}
      <button type="button" onclick={() => store.dispatch({ type: 'dismiss-notice' })}>OK</button>
    </div>
  {/if}

  <div class="row transport">
    <button type="button" class="primary" disabled={!audioReady} onclick={togglePlay}>
      {playing ? 'Pause' : 'Play'}
    </button>
    <span aria-label="Playhead time">{formatTime(ed.playhead)} / {formatTime(duration)}</span>
    <input
      class="grow"
      type="range"
      min="0"
      max={duration}
      step="0.1"
      value={ed.playhead}
      aria-label="Scrub"
      oninput={(e) => seek(Number((e.currentTarget as HTMLInputElement).value))}
    />
  </div>

  <Waveform
    {program}
    {energy}
    playhead={ed.playhead}
    selectedId={ed.selectedSegmentId}
    onselect={pickSegment}
    onseek={seek}
    onmoveboundary={(index, to) => store.dispatch({ type: 'move-boundary', index, to })}
  />

  {#if selected}
    <section class="card" aria-label="Selected section">
      <h2>{segmentTitle(program, selected)}</h2>
      <div class="row" role="group" aria-label="Intensity">
        {#each TIER_LIST as tier (tier)}
          <button
            type="button"
            class="tier-{tier}"
            aria-pressed={selected.tier === tier}
            class:current={selected.tier === tier}
            onclick={() => store.dispatch({ type: 'set-tier', segmentId: selected.id, tier })}
          >
            {TIER_LABEL[tier]}
          </button>
        {/each}
      </div>
      <div class="row">
        <label>
          <span class="muted">Name</span>
          <input
            type="text"
            list="section-labels-{uid}"
            value={selected.label ?? ''}
            placeholder={segmentTitle(program, selected)}
            aria-label="Section name"
            onchange={(e) =>
              store.dispatch({
                type: 'set-label',
                segmentId: selected.id,
                label: (e.currentTarget as HTMLInputElement).value,
              })}
          />
        </label>
        <datalist id="section-labels-{uid}">
          {#each usedLabels(program) as label (label)}<option value={label}></option>{/each}
        </datalist>
        <button
          type="button"
          disabled={!canSplitSelected}
          onclick={() => store.dispatch({ type: 'split', segmentId: selected.id, at: ed.playhead })}
        >
          Split at playhead
        </button>
        <button
          type="button"
          disabled={selectedIndex <= 0}
          onclick={() => store.dispatch({ type: 'merge', segmentId: selected.id })}
        >
          Merge into previous
        </button>
        <button
          type="button"
          class="danger"
          disabled={program.segments.length === 1}
          onclick={() => store.dispatch({ type: 'delete-segment', segmentId: selected.id })}
        >
          Delete section
        </button>
      </div>
    </section>
  {/if}

  <IntervalForm playhead={ed.playhead} {duration} dispatch={(c) => store.dispatch(c)} />

  <ClassStrip {program} selectedClips={ed.selectedClips} dispatch={(c) => store.dispatch(c)} />

  <BlockList
    {program}
    selectedClips={ed.selectedClips}
    playhead={ed.playhead}
    dispatch={(c) => store.dispatch(c)}
  />
</main>

<style>
  .top {
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .back {
    color: var(--muted);
  }
  .track-title {
    flex: 1;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .grow {
    flex: 1;
  }
  label.grow {
    display: flex;
    flex-direction: column;
  }
  .transport {
    margin: 22px 0 16px;
    padding: 12px;
    border: 1px solid var(--border);
    background: linear-gradient(90deg, rgb(36 3 252 / 0.14), transparent 42%);
  }
  button.current {
    outline: 3px solid var(--text);
    font-weight: 700;
  }
  @media (max-width: 620px) {
    .top .track-title {
      order: 3;
      flex-basis: 100%;
    }
    label.grow {
      flex-basis: 100%;
    }
    .transport .grow {
      flex-basis: 100%;
    }
  }
</style>
