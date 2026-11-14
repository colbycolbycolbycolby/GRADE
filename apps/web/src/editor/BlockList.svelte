<script lang="ts">
  import { MIN_SEGMENT_SEC, segmentTitle } from '@grade/core';
  import type { Program } from '@grade/schema';
  import type { Command } from './model';
  import { usedLabels } from './model';
  import { formatTime } from './geometry';
  import { TIER_LABEL, TIER_LIST } from './tiers';

  interface Props {
    program: Program;
    selectedClips: number[];
    playhead: number;
    dispatch: (command: Command) => void;
  }
  let { program, selectedClips, playhead, dispatch }: Props = $props();

  const uid = $props.id();
  const labels = $derived(usedLabels(program));
  const onlyOne = $derived(program.clips.length === 1);

  function canSplit(segIndex: number): boolean {
    const s = program.segments[segIndex]!;
    return playhead - s.start >= MIN_SEGMENT_SEC && s.end - playhead >= MIN_SEGMENT_SEC;
  }
</script>

<section aria-label="Blocks">
  <h2>Blocks</h2>
  <datalist id="labels-{uid}">
    {#each labels as label (label)}<option value={label}></option>{/each}
  </datalist>

  {#if selectedClips.length > 0}
    <div class="row card" role="group" aria-label="Selected blocks">
      <span>{selectedClips.length} selected</span>
      <button type="button" onclick={() => dispatch({ type: 'duplicate', indices: selectedClips })}>
        Repeat selected
      </button>
      <button
        type="button"
        class="danger"
        disabled={selectedClips.length >= program.clips.length}
        onclick={() => dispatch({ type: 'remove', indices: selectedClips })}
      >
        Remove selected
      </button>
      <button type="button" onclick={() => dispatch({ type: 'clear-clip-selection' })}>
        Clear
      </button>
    </div>
  {/if}

  <ol class="blocks">
    {#each program.clips as clip, i (clip.id)}
      {@const segIndex = program.segments.findIndex((s) => s.id === clip.segmentId)}
      {@const seg = program.segments[segIndex]!}
      {@const title = segmentTitle(program, seg)}
      <li class="card block">
        <div class="row">
          <input
            type="checkbox"
            checked={selectedClips.includes(i)}
            aria-label={`Select block ${i + 1}`}
            onchange={() => dispatch({ type: 'toggle-clip', index: i })}
          />
          <span class="swatch tier-{seg.tier}" aria-hidden="true"></span>
          <strong>{i + 1}. {title}</strong>
          <span class="muted">{formatTime(clip.end - clip.start)}</span>
        </div>
        <div class="row">
          <label>
            Name
            <input
              type="text"
              list="labels-{uid}"
              value={seg.label ?? ''}
              placeholder={title}
              aria-label={`Name of block ${i + 1}`}
              onchange={(e) =>
                dispatch({
                  type: 'set-label',
                  segmentId: seg.id,
                  label: (e.currentTarget as HTMLInputElement).value,
                })}
            />
          </label>
          <label>
            Intensity
            <select
              value={seg.tier}
              aria-label={`Intensity of block ${i + 1}`}
              onchange={(e) =>
                dispatch({
                  type: 'set-tier',
                  segmentId: seg.id,
                  tier: (e.currentTarget as HTMLSelectElement).value as typeof seg.tier,
                })}
            >
              {#each TIER_LIST as tier (tier)}
                <option value={tier}>{TIER_LABEL[tier]}</option>
              {/each}
            </select>
          </label>
        </div>
        <div class="row">
          <button
            type="button"
            disabled={i === 0}
            aria-label={`Move block ${i + 1} earlier`}
            onclick={() => dispatch({ type: 'reorder', indices: [i], to: i - 1 })}>Earlier</button
          >
          <button
            type="button"
            disabled={i === program.clips.length - 1}
            aria-label={`Move block ${i + 1} later`}
            onclick={() => dispatch({ type: 'reorder', indices: [i], to: i + 2 })}>Later</button
          >
          <button
            type="button"
            aria-label={`Repeat block ${i + 1}`}
            onclick={() => dispatch({ type: 'duplicate', indices: [i] })}>Repeat</button
          >
          <button
            type="button"
            disabled={!canSplit(segIndex)}
            title="Split this section at the playhead"
            aria-label={`Split block ${i + 1} at the playhead`}
            onclick={() => dispatch({ type: 'split', segmentId: seg.id, at: playhead })}
            >Split</button
          >
          <button
            type="button"
            disabled={segIndex === 0}
            aria-label={`Merge block ${i + 1} into the previous section`}
            onclick={() => dispatch({ type: 'merge', segmentId: seg.id })}>Merge</button
          >
          <button
            type="button"
            class="danger"
            disabled={program.segments.length === 1}
            aria-label={`Delete the section of block ${i + 1}`}
            onclick={() => dispatch({ type: 'delete-segment', segmentId: seg.id })}>Delete</button
          >
          <button
            type="button"
            class="danger"
            disabled={onlyOne}
            aria-label={`Remove block ${i + 1} from the class order`}
            onclick={() => dispatch({ type: 'remove', indices: [i] })}>Remove from order</button
          >
        </div>
      </li>
    {/each}
  </ol>
</section>

<style>
  .blocks {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .swatch {
    width: 16px;
    height: 16px;
    border-radius: 4px;
  }
  label {
    display: flex;
    flex-direction: column;
    font-size: 0.8rem;
    gap: 2px;
  }
</style>
