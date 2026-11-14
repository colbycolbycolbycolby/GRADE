<script lang="ts">
  import type { ScheduleItem } from '@grade/core';
  import type { Tier } from '@grade/schema';
  import { CUE_TEXT, TIER_LABEL } from '../editor/tiers';
  import { formatTime } from '../editor/geometry';
  import MiniWave from './MiniWave.svelte';
  import type { EnergyPoint } from './energy';

  interface Props {
    tier: Tier;
    title: string;
    songTitle: string;
    songIndex: number;
    songCount: number;
    /** Seconds left in the current block. */
    blockRemaining: number;
    upcoming: ScheduleItem[];
    playing: boolean;
    /** The next song is loading and the current one has ended. */
    waitingForSong: boolean;
    classTime: number;
    classTotal: number;
    energy: EnergyPoint[];
    boundaries: number[];
    /** 0..1, the energy of the song now. */
    pulse: number;
    keepAwake: 'held' | 'unsupported' | 'lost';
    notice: string;
    onplaypause: () => void;
    onskip: (delta: number) => void;
    onnext: () => void;
    onend: () => void;
  }
  let {
    tier,
    title,
    songTitle,
    songIndex,
    songCount,
    blockRemaining,
    upcoming,
    playing,
    waitingForSong,
    classTime,
    classTotal,
    energy,
    boundaries,
    pulse,
    keepAwake,
    notice,
    onplaypause,
    onskip,
    onnext,
    onend,
  }: Props = $props();

  let confirmEnd = $state(false);
  const lastSong = $derived(songIndex >= songCount - 1);
</script>

<div class="runner" data-tier={tier} style="--pulse: {pulse}">
  <div class="top">
    <span class="song">
      {#if songCount > 1}Song {songIndex + 1} of {songCount} &middot;{/if}
      {songTitle}
    </span>
    <span>{formatTime(classTime)} / {formatTime(classTotal)}</span>
  </div>

  <div class="main">
    {#if waitingForSong}
      <p class="cue" role="status">Loading next song&hellip;</p>
    {:else}
      <p class="cue" aria-live="polite">{CUE_TEXT[tier]}</p>
      <p class="tier">{TIER_LABEL[tier]}</p>
      <h1 class="title">{title}</h1>
      <p class="count" role="timer" aria-label="Time left in this block">
        {formatTime(Math.ceil(blockRemaining))}
      </p>
    {/if}
  </div>

  {#if upcoming.length > 0}
    <div class="next">
      <span class="label">Coming up</span>
      <ol>
        {#each upcoming as item (item.clipId)}
          <li>
            <span>{item.title}</span>
            <span class="tier-name">{TIER_LABEL[item.tier]}</span>
            <span>{formatTime(item.classEnd - item.classStart)}</span>
          </li>
        {/each}
      </ol>
    </div>
  {/if}

  <MiniWave {energy} total={classTotal} {classTime} {boundaries} />

  {#if notice}<p class="notice" role="alert">{notice}</p>{/if}
  {#if keepAwake !== 'held'}
    <p class="notice">
      {keepAwake === 'unsupported'
        ? 'This browser cannot keep the screen on. Turn off the screen lock.'
        : 'The screen may lock. Turn off the screen lock.'}
    </p>
  {/if}

  <div class="controls">
    <button type="button" onclick={() => onskip(-10)} aria-label="Back 10 seconds"
      >&minus;10 s</button
    >
    <button type="button" class="big" onclick={onplaypause} disabled={waitingForSong}>
      {playing ? 'Pause' : 'Play'}
    </button>
    <button type="button" onclick={() => onskip(10)} aria-label="Forward 10 seconds">+10 s</button>
  </div>
  <div class="controls">
    {#if songCount > 1}
      <button type="button" onclick={onnext}>{lastSong ? 'Finish class' : 'Next song'}</button>
    {/if}
    <button
      type="button"
      onclick={() => {
        if (confirmEnd) onend();
        else confirmEnd = true;
      }}
      onblur={() => (confirmEnd = false)}
    >
      {confirmEnd ? 'Tap again to end' : 'End class'}
    </button>
  </div>
</div>

<style>
  .runner {
    position: fixed;
    inset: 0;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    padding-bottom: max(16px, env(safe-area-inset-bottom));
    overflow: auto;
    color: var(--on-easy);
    background: var(--tier-easy);
    transition: background-color 0.4s;
    font-family: var(--font-display);
  }
  .runner[data-tier='moderate'] {
    color: var(--on-moderate);
    background: var(--tier-moderate);
  }
  .runner[data-tier='hard'] {
    color: var(--on-hard);
    background: var(--tier-hard);
  }
  .runner[data-tier='allout'] {
    color: var(--on-allout);
    background: var(--tier-allout);
  }
  /* The pulse sits under the text, inside this stacking context. */
  .runner::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    background:
      linear-gradient(115deg, transparent 0 63%, rgb(36 3 252 / 0.2) 63% 67%, transparent 67%),
      radial-gradient(circle at 50% 40%, #fff, transparent 70%);
    opacity: calc(var(--pulse, 0) * 0.35);
    transition: opacity 0.3s;
    pointer-events: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .runner,
    .runner::before {
      transition: none;
    }
  }
  .top {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-weight: 600;
  }
  .song {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    min-height: 0;
  }
  .cue {
    margin: 0;
    font-size: clamp(2.5rem, 12vw, 6rem);
    font-weight: 800;
    line-height: 1.05;
  }
  .tier {
    margin: 4px 0 0;
    font-size: 1.1rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .title {
    margin: 12px 0 0;
    font-size: clamp(1.4rem, 6vw, 2.4rem);
  }
  .count {
    margin: 8px 0 0;
    font-size: clamp(5rem, 28vw, 14rem);
    font-weight: 800;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .next .label {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  ol {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
  }
  li {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 12px;
    padding: 4px 0;
    border-top: 1px solid color-mix(in srgb, currentColor 30%, transparent);
  }
  .tier-name {
    opacity: 0.85;
  }
  .notice {
    margin: 0;
    padding: 8px 12px;
    border-radius: var(--radius);
    background: color-mix(in srgb, currentColor 18%, transparent);
  }
  .controls {
    display: flex;
    gap: 12px;
    justify-content: center;
  }
  .controls button {
    flex: 1;
    max-width: 220px;
    min-height: 64px;
    font-size: 1.2rem;
    font-weight: 700;
    color: inherit;
    background: color-mix(in srgb, currentColor 16%, transparent);
    border: 2px solid currentColor;
  }
  .controls button.big {
    flex: 1.5;
  }
</style>
