<script lang="ts">
  import { MIN_SEGMENT_SEC } from '@grade/core';
  import type { Command } from './model';
  import { formatTime } from './geometry';

  interface Props {
    playhead: number;
    duration: number;
    dispatch: (command: Command) => void;
  }
  let { playhead, duration, dispatch }: Props = $props();

  let onSec = $state(20);
  let offSec = $state(20);
  let label = $state('All out');

  const valid = $derived(
    onSec >= MIN_SEGMENT_SEC && offSec >= MIN_SEGMENT_SEC && duration - playhead >= MIN_SEGMENT_SEC,
  );
</script>

<section class="card" aria-label="Intervals">
  <h2>Intervals</h2>
  <p class="muted">
    This replaces everything after the playhead ({formatTime(playhead)}) with all-out and easy
    parts. You can undo it.
  </p>
  <div class="row">
    <label>On (s) <input type="number" min={MIN_SEGMENT_SEC} bind:value={onSec} /></label>
    <label>Off (s) <input type="number" min={MIN_SEGMENT_SEC} bind:value={offSec} /></label>
    <label>Name <input type="text" bind:value={label} /></label>
    <button
      type="button"
      class="primary"
      disabled={!valid}
      onclick={() => dispatch({ type: 'intervals', from: playhead, onSec, offSec, label })}
    >
      Make intervals
    </button>
  </div>
</section>

<style>
  label {
    display: flex;
    flex-direction: column;
    font-size: 0.8rem;
    gap: 2px;
  }
  input[type='number'] {
    width: 6rem;
  }
</style>
