<script lang="ts">
  import { MIN_SEGMENT_SEC, segmentTitle, similarityHint } from '@grade/core';
  import type { Program } from '@grade/schema';
  import { drawWaveform, readTierColors } from './draw';
  import { clampBoundary, formatTime, segmentIndexAt, timeToX, xToTime } from './geometry';
  import { TIER_LABEL } from './tiers';

  interface Props {
    program: Program;
    energy: { t: number; e: number }[];
    playhead: number;
    selectedId: string | null;
    onselect: (id: string) => void;
    onseek: (t: number) => void;
    onmoveboundary: (index: number, to: number) => void;
  }
  let { program, energy, playhead, selectedId, onselect, onseek, onmoveboundary }: Props = $props();

  const KEY_STEP = 0.5;
  const KEY_STEP_BIG = 5;

  let canvas: HTMLCanvasElement | undefined = $state();
  let width = $state(0);
  const height = 120;

  const duration = $derived(program.segments[program.segments.length - 1]?.end ?? 0);
  let drag: { index: number; to: number } | null = $state(null);

  /** Segments as drawn: the boundary being dragged shows at its dragged place. */
  const shown = $derived(
    program.segments.map((s, i, all) => {
      if (!drag) return s;
      if (i === drag.index) return { ...s, end: drag.to };
      if (i === drag.index + 1) return { ...s, start: drag.to };
      return all[i]!;
    }),
  );
  const selectedIndex = $derived(program.segments.findIndex((s) => s.id === selectedId));

  $effect(() => {
    const el = canvas;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.max(Math.floor(width * dpr), 1);
    el.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawWaveform(ctx, {
      width,
      height,
      energy,
      duration,
      segments: shown,
      selectedIndex,
      colors: readTierColors(el),
      selectedOutline: getComputedStyle(el).getPropertyValue('--accent').trim() || '#5f5cff',
    });
  });

  function timeAt(event: PointerEvent): number {
    const target = event.currentTarget as HTMLElement;
    const surface = target.classList.contains('section-hit') ? target.parentElement! : target;
    const rect = surface.getBoundingClientRect();
    return xToTime(event.clientX - rect.left, duration, rect.width);
  }

  function pick(event: PointerEvent, segmentId?: string) {
    const t = timeAt(event);
    const seg = segmentId
      ? program.segments.find((candidate) => candidate.id === segmentId)
      : program.segments[segmentIndexAt(program.segments, t)];
    if (seg) onselect(seg.id);
    onseek(t);
  }

  function startDrag(event: PointerEvent, index: number) {
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    drag = { index, to: program.segments[index]!.end };
  }

  function moveDrag(event: PointerEvent) {
    if (!drag) return;
    const wrap = (event.currentTarget as HTMLElement).parentElement!;
    const rect = wrap.getBoundingClientRect();
    const t = xToTime(event.clientX - rect.left, duration, rect.width);
    drag = {
      index: drag.index,
      to: clampBoundary(program.segments, drag.index, t, MIN_SEGMENT_SEC),
    };
  }

  function endDrag() {
    if (!drag) return;
    const { index, to } = drag;
    drag = null;
    if (Math.abs(to - program.segments[index]!.end) > 1e-6) onmoveboundary(index, to);
  }

  function keyMove(event: KeyboardEvent, index: number) {
    const dir = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (dir === 0) return;
    event.preventDefault();
    const step = event.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    const to = clampBoundary(
      program.segments,
      index,
      program.segments[index]!.end + dir * step,
      MIN_SEGMENT_SEC,
    );
    if (Math.abs(to - program.segments[index]!.end) > 1e-6) onmoveboundary(index, to);
  }

  const pct = (t: number) => `${(duration > 0 ? (t / duration) * 100 : 0).toFixed(3)}%`;
</script>

<div class="waveform">
  <div class="plot" bind:clientWidth={width} style:height="{height}px">
    <canvas bind:this={canvas} style:width="100%" style:height="{height}px" aria-hidden="true"
    ></canvas>
    {#each program.segments as seg (seg.id)}
      <button
        type="button"
        class="section-hit"
        class:selected={seg.id === selectedId}
        style:left={pct(seg.start)}
        style:width={pct(seg.end - seg.start)}
        aria-label={`Select ${segmentTitle(program, seg)} on waveform`}
        aria-pressed={seg.id === selectedId}
        title={`Select ${segmentTitle(program, seg)}`}
        onpointerdown={(event) => pick(event, seg.id)}
      ></button>
    {/each}
    <div class="playhead" style:left={pct(playhead)} aria-hidden="true"></div>
    {#each program.segments.slice(0, -1) as seg, i (seg.id)}
      <div
        class="divider"
        class:dragging={drag?.index === i}
        style:left={`${timeToX(drag?.index === i ? drag.to : seg.end, duration, width)}px`}
        role="slider"
        tabindex="0"
        aria-label={`Boundary after ${segmentTitle(program, seg)}`}
        aria-orientation="horizontal"
        aria-valuemin={seg.start + MIN_SEGMENT_SEC}
        aria-valuemax={program.segments[i + 1]!.end - MIN_SEGMENT_SEC}
        aria-valuenow={seg.end}
        aria-valuetext={formatTime(seg.end)}
        onpointerdown={(e) => startDrag(e, i)}
        onpointermove={moveDrag}
        onpointerup={endDrag}
        onpointercancel={endDrag}
        onkeydown={(e) => keyMove(e, i)}
      ></div>
    {/each}
  </div>

  <!-- Section numbers sit below the waveform, never over it. -->
  <div class="labels">
    {#each shown as seg, i (seg.id)}
      {@const hint = similarityHint(program, seg)}
      <button
        type="button"
        class="label"
        class:selected={seg.id === selectedId}
        style:left={pct(seg.start)}
        style:width={pct(seg.end - seg.start)}
        aria-pressed={seg.id === selectedId}
        onclick={() => onselect(seg.id)}
      >
        <span class="swatch tier-{seg.tier}" aria-hidden="true"></span>
        <span class="name">{segmentTitle(program, program.segments[i]!)}</span>
        {#if hint}<span class="hint muted" title="Sounds like section {hint.slice(1)}">{hint}</span
          >{/if}
        <span class="tier muted">{TIER_LABEL[seg.tier]}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .waveform {
    margin-bottom: 12px;
  }
  .plot {
    position: relative;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    touch-action: pan-y;
    color: var(--text);
  }
  canvas {
    display: block;
  }
  .section-hit {
    position: absolute;
    z-index: 1;
    inset-block: 0;
    min-width: 0;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    cursor: pointer;
  }
  .section-hit:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -3px;
  }
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--text);
    pointer-events: none;
    z-index: 3;
  }
  .divider {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 24px;
    margin-left: -12px;
    cursor: ew-resize;
    touch-action: none;
    z-index: 2;
  }
  .divider::after {
    content: '';
    position: absolute;
    left: 11px;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--text);
    opacity: 0.55;
  }
  .divider.dragging::after,
  .divider:focus-visible::after {
    opacity: 1;
    width: 4px;
    left: 10px;
  }
  .labels {
    position: relative;
    height: 52px;
    margin-top: 4px;
  }
  .label {
    position: absolute;
    top: 0;
    height: 100%;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    padding: 2px 4px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    font-size: 0.8rem;
    line-height: 1.2;
    border-radius: 4px;
    text-align: left;
  }
  .label.selected {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
    box-shadow: inset 0 -3px var(--accent);
  }
  .swatch {
    display: block;
    width: 100%;
    height: 4px;
    margin-bottom: 2px;
    border-radius: 2px;
  }
  .name {
    font-weight: 600;
    white-space: nowrap;
  }
  .hint,
  .tier {
    font-size: 0.7rem;
    white-space: nowrap;
  }
</style>
