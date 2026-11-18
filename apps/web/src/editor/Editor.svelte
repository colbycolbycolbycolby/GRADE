<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    MIN_SEGMENT_SEC,
    WORKOUT_FORMATS,
    addProgramTag,
    removeProgramTag,
    segmentTitle,
    workoutFields,
  } from '@grade/core';
  import type { Analysis, Position, Program, Track, WorkoutFormat } from '@grade/schema';
  import { exportProgram } from '../app/programFiles';
  import type { Services } from '../app/services';
  import { hrefs } from '../app/router';
  import { OffsetBackend, type PlaybackBackend } from '../playback';
  import { clampBoundary, formatTime } from './geometry';
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
  const selectedWorkout = $derived(selected ? workoutFields(selected) : {});
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
  let titleMenuOpen = $state(false);
  let tagInput = $state('');
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
    window.addEventListener('keydown', onEditorKeydown);
  });

  onDestroy(() => {
    for (const fn of off) fn();
    backend?.dispose();
    window.removeEventListener('keydown', onEditorKeydown);
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

  function isTextEntry(target: EventTarget | null): boolean {
    return (
      target instanceof Element &&
      !!target.closest('input, textarea, select, [contenteditable="true"]')
    );
  }

  function onEditorKeydown(event: KeyboardEvent) {
    if (isTextEntry(event.target)) return;
    const commandKey = event.metaKey || event.ctrlKey;
    if (commandKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) {
        if (canRedoState(ed)) store.dispatch({ type: 'redo' });
      } else if (canUndoState(ed)) store.dispatch({ type: 'undo' });
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      if (canRedoState(ed)) store.dispatch({ type: 'redo' });
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    const step = event.shiftKey ? 5 : 0.5;
    event.preventDefault();
    if (event.altKey && selectedIndex >= 0 && program.segments.length > 1) {
      const boundaryIndex = Math.min(selectedIndex, program.segments.length - 2);
      const boundary = program.segments[boundaryIndex]!;
      store.dispatch({
        type: 'move-boundary',
        index: boundaryIndex,
        to: clampBoundary(
          program.segments,
          boundaryIndex,
          boundary.end + direction * step,
          MIN_SEGMENT_SEC,
        ),
      });
      return;
    }
    seek(Math.min(duration, Math.max(0, ed.playhead + direction * step)));
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

  function addTag() {
    const next = addProgramTag(program, tagInput);
    if (next !== program) store.dispatch({ type: 'set-program-tags', tags: next.tags ?? [] });
    tagInput = '';
  }

  function numberValue(input: HTMLInputElement): number | undefined {
    if (input.value === '') return undefined;
    const value = Number(input.value);
    return Number.isInteger(value) ? value : undefined;
  }

  function updateCadence(part: 'min' | 'max', value: number | undefined) {
    if (!selected) return;
    const current = selectedWorkout.cadence;
    const minRpm = part === 'min' ? value : current?.minRpm;
    const maxRpm = part === 'max' ? value : current?.maxRpm;
    const cadence =
      minRpm !== undefined &&
      minRpm >= 1 &&
      minRpm <= 250 &&
      (maxRpm === undefined || (maxRpm >= minRpm && maxRpm <= 250))
        ? { minRpm, ...(maxRpm === undefined ? {} : { maxRpm }) }
        : undefined;
    store.dispatch({
      type: 'set-workout-fields',
      segmentId: selected.id,
      resistanceZone: selected.resistanceZone,
      position: selected.position,
      cadence,
    });
  }

  const splitTarget = $derived(
    program.segments.find((segment) => ed.playhead >= segment.start && ed.playhead < segment.end),
  );
  const canSplitAtPlayhead = $derived(
    !!splitTarget &&
      ed.playhead - splitTarget.start >= MIN_SEGMENT_SEC &&
      splitTarget.end - ed.playhead >= MIN_SEGMENT_SEC,
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

  <section class="program-workout" aria-label="Program workout classification">
    <label>
      <span class="muted">Workout format</span>
      <select
        aria-label="Workout format"
        value={program.workoutFormat ?? ''}
        onchange={(event) =>
          store.dispatch({
            type: 'set-workout-format',
            workoutFormat:
              ((event.currentTarget as HTMLSelectElement).value as WorkoutFormat) || undefined,
          })}
      >
        <option value="">Not set</option>
        {#each WORKOUT_FORMATS as format (format.value)}
          <option value={format.value}>{format.label}</option>
        {/each}
      </select>
    </label>
    <form
      class="tag-form"
      onsubmit={(event) => {
        event.preventDefault();
        addTag();
      }}
    >
      <label>
        <span class="muted">Program tags</span>
        <input bind:value={tagInput} aria-label="Add tag" placeholder="Add tag" />
      </label>
      <button type="submit" disabled={!tagInput.trim()}>Add tag</button>
    </form>
    {#if (program.tags ?? []).length > 0}
      <div class="tags" aria-label="Program tags">
        {#each program.tags ?? [] as tag (tag)}
          <span class="tag">
            {tag}
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              onclick={() =>
                store.dispatch({
                  type: 'set-program-tags',
                  tags: removeProgramTag(program, tag).tags ?? [],
                })}>×</button
            >
          </span>
        {/each}
      </div>
    {/if}
  </section>

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
    <button
      type="button"
      class="split-marker"
      disabled={!canSplitAtPlayhead}
      aria-label="Split section at playhead"
      title="Split the section under the playhead (at least 2 seconds from either edge)"
      onclick={() =>
        splitTarget &&
        store.dispatch({ type: 'split', segmentId: splitTarget.id, at: ed.playhead })}
    >
      <span aria-hidden="true">&#128205;</span> Split here
    </button>
  </div>

  <p class="shortcut-help muted">
    Keyboard: ←/→ move 0.5s · Shift moves 5s · Option/Alt + ←/→ adjusts the selected boundary ·
    ⌘/Ctrl + Z undo
  </p>

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
        <div class="name-field">
          <label>
            <span class="muted">Name</span>
            <input
              type="text"
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
          {#if usedLabels(program).length > 0}
            <button
              type="button"
              class="reuse-title"
              aria-expanded={titleMenuOpen}
              aria-controls="reuse-title-{uid}"
              onclick={() => (titleMenuOpen = !titleMenuOpen)}>Reuse a title</button
            >
            {#if titleMenuOpen}
              <div class="title-menu" id="reuse-title-{uid}" role="menu">
                {#each usedLabels(program) as label (label)}
                  <button
                    type="button"
                    role="menuitem"
                    onclick={() => {
                      store.dispatch({ type: 'set-label', segmentId: selected.id, label });
                      titleMenuOpen = false;
                    }}>{label}</button
                  >
                {/each}
              </div>
            {/if}
          {/if}
        </div>
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
      <div class="workout-fields" aria-label="Section workout fields">
        <label>
          <span class="muted">Resistance</span>
          <select
            aria-label="Resistance zone"
            value={selectedWorkout.resistanceZone ?? ''}
            onchange={(event) => {
              const value = (event.currentTarget as HTMLSelectElement).value;
              store.dispatch({
                type: 'set-workout-fields',
                segmentId: selected.id,
                resistanceZone: value ? Number(value) : undefined,
                cadence: selected.cadence,
                position: selected.position,
              });
            }}
          >
            <option value="">Not set</option>
            {#each [1, 2, 3, 4, 5] as zone (zone)}<option value={zone}>Z{zone}</option>{/each}
          </select>
        </label>
        <label>
          <span class="muted">RPM target / min</span>
          <input
            type="number"
            min="1"
            max="250"
            aria-label="Cadence minimum RPM"
            value={selectedWorkout.cadence?.minRpm ?? ''}
            onchange={(event) => updateCadence('min', numberValue(event.currentTarget))}
          />
        </label>
        <label>
          <span class="muted">RPM max (optional)</span>
          <input
            type="number"
            min={selectedWorkout.cadence?.minRpm ?? 1}
            max="250"
            aria-label="Cadence maximum RPM"
            value={selectedWorkout.cadence?.maxRpm ?? ''}
            onchange={(event) => updateCadence('max', numberValue(event.currentTarget))}
          />
        </label>
        <label>
          <span class="muted">Position</span>
          <select
            aria-label="Position"
            value={selectedWorkout.position ?? ''}
            onchange={(event) =>
              store.dispatch({
                type: 'set-workout-fields',
                segmentId: selected.id,
                resistanceZone: selected.resistanceZone,
                cadence: selected.cadence,
                position:
                  ((event.currentTarget as HTMLSelectElement).value as Position) || undefined,
              })}
          >
            <option value="">Not set</option>
            <option value="seated">Seated</option>
            <option value="standing">Standing</option>
            <option value="mixed">Mixed</option>
          </select>
        </label>
      </div>
    </section>
  {/if}

  <IntervalForm playhead={ed.playhead} {duration} dispatch={(c) => store.dispatch(c)} />
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
  .program-workout {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 8px 14px;
    margin: 10px 0 4px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .program-workout label,
  .workout-fields label {
    display: flex;
    flex-direction: column;
  }
  .tag-form,
  .tags {
    display: flex;
    align-items: end;
    gap: 6px;
  }
  .tags {
    flex-basis: 100%;
    flex-wrap: wrap;
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 4px 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 12%, var(--surface));
    font-size: 0.8rem;
  }
  .tag button {
    min-height: 22px;
    padding: 0 5px;
    border: 0;
    background: transparent;
  }
  .workout-fields {
    display: grid;
    grid-template-columns: repeat(4, minmax(110px, 1fr));
    gap: 10px;
    margin: 12px 0;
  }
  .transport {
    margin: 22px 0 16px;
    padding: 12px;
    border: 1px solid var(--border);
    background: linear-gradient(90deg, rgb(36 3 252 / 0.14), transparent 42%);
  }
  .split-marker {
    white-space: nowrap;
  }
  .shortcut-help {
    margin: -10px 0 12px;
    font-size: 0.78rem;
  }
  .name-field {
    position: relative;
    display: flex;
    align-items: end;
    gap: 6px;
  }
  .name-field label {
    display: flex;
    flex-direction: column;
  }
  .reuse-title {
    padding-inline: 9px;
  }
  .title-menu {
    position: absolute;
    z-index: 10;
    top: calc(100% + 4px);
    left: 0;
    min-width: 100%;
    max-height: 220px;
    overflow: auto;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: 0 10px 28px rgb(0 0 0 / 0.22);
  }
  .title-menu button {
    display: block;
    width: 100%;
    text-align: left;
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
    .workout-fields {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
