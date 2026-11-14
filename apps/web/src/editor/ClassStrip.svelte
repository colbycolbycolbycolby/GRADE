<script lang="ts">
  import { MIN_CLIP_SEC, segmentTitle } from '@grade/core';
  import type { Program } from '@grade/schema';
  import type { Command } from './model';
  import { formatTime, insertionIndex, trimEdge } from './geometry';
  import { TIER_LABEL } from './tiers';

  interface Props {
    program: Program;
    selectedClips: number[];
    dispatch: (command: Command) => void;
  }
  let { program, selectedClips, dispatch }: Props = $props();

  const PX_PER_SEC = 4;
  const MIN_TILE_PX = 84;

  let strip: HTMLElement | undefined = $state();
  let dragging: number[] | null = $state(null);
  let dropAt: number | null = $state(null);
  let trim: { clipId: string; start: number; end: number } | null = $state(null);
  let trimDrag: {
    clipId: string;
    edge: 'start' | 'end';
    x0: number;
    secPerPx: number;
    start: number;
    end: number;
  } | null = null;

  function shown(clip: Program['clips'][number]) {
    return trim && trim.clipId === clip.id ? trim : clip;
  }

  function onDragStart(event: DragEvent, index: number) {
    if (trimDrag) {
      event.preventDefault();
      return;
    }
    dragging = selectedClips.includes(index) ? selectedClips : [index];
    event.dataTransfer?.setData('text/plain', 'grade-clips');
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copyMove';
  }

  function onDragOver(event: DragEvent) {
    if (!dragging || !strip) return;
    event.preventDefault();
    const tiles = [...strip.querySelectorAll<HTMLElement>('[data-tile]')];
    dropAt = insertionIndex(
      tiles.map((t) => {
        const r = t.getBoundingClientRect();
        return { left: r.left, width: r.width };
      }),
      event.clientX,
    );
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    if (dragging && dropAt !== null) dispatch({ type: 'reorder', indices: dragging, to: dropAt });
    endDrag();
  }

  function dropOn(event: DragEvent, type: 'duplicate' | 'remove') {
    event.preventDefault();
    if (dragging) dispatch({ type, indices: dragging });
    endDrag();
  }

  function endDrag() {
    dragging = null;
    dropAt = null;
  }

  function startTrim(event: PointerEvent, index: number, edge: 'start' | 'end') {
    event.stopPropagation();
    const clip = program.clips[index]!;
    const tile = (event.currentTarget as HTMLElement).closest('[data-tile]') as HTMLElement;
    const len = clip.end - clip.start;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    trimDrag = {
      clipId: clip.id,
      edge,
      x0: event.clientX,
      secPerPx: len / Math.max(tile.getBoundingClientRect().width, 1),
      start: clip.start,
      end: clip.end,
    };
    trim = { clipId: clip.id, start: clip.start, end: clip.end };
  }

  function moveTrim(event: PointerEvent, index: number) {
    if (!trimDrag) return;
    const clip = program.clips[index]!;
    const segment = program.segments.find((s) => s.id === clip.segmentId)!;
    const delta = (event.clientX - trimDrag.x0) * trimDrag.secPerPx;
    const next = trimEdge(
      { start: trimDrag.start, end: trimDrag.end },
      segment,
      trimDrag.edge,
      delta,
      MIN_CLIP_SEC,
    );
    trim = { clipId: clip.id, ...next };
  }

  function endTrim() {
    const done = trim;
    trimDrag = null;
    trim = null;
    if (done) {
      const clip = program.clips.find((c) => c.id === done.clipId);
      if (clip && (done.start !== clip.start || done.end !== clip.end)) {
        dispatch({ type: 'trim', clipId: done.clipId, start: done.start, end: done.end });
      }
    }
  }
</script>

<section class="strip-wrap" aria-label="Class order">
  <h2>Class order</h2>
  <div
    class="strip"
    bind:this={strip}
    role="list"
    ondragover={onDragOver}
    ondrop={onDrop}
    ondragleave={() => (dropAt = null)}
  >
    {#each program.clips as clip, i (clip.id)}
      {@const seg = program.segments.find((s) => s.id === clip.segmentId)!}
      {@const view = shown(clip)}
      {@const len = view.end - view.start}
      <div
        class="tile tier-{seg.tier}"
        class:selected={selectedClips.includes(i)}
        class:drop-before={dropAt === i}
        class:drop-end={dropAt === program.clips.length && i === program.clips.length - 1}
        data-tile
        role="listitem"
        draggable="true"
        style:width="{Math.max(len * PX_PER_SEC, MIN_TILE_PX)}px"
        ondragstart={(e) => onDragStart(e, i)}
        ondragend={endDrag}
      >
        <input
          type="checkbox"
          class="pick"
          checked={selectedClips.includes(i)}
          aria-label={`Select ${segmentTitle(program, seg)}`}
          onchange={() => dispatch({ type: 'toggle-clip', index: i })}
        />
        <span
          class="edge start"
          aria-hidden="true"
          title="Drag to trim the start"
          onpointerdown={(e) => startTrim(e, i, 'start')}
          onpointermove={(e) => moveTrim(e, i)}
          onpointerup={endTrim}
          onpointercancel={endTrim}
        ></span>
        <span class="body">
          <strong>{segmentTitle(program, seg)}</strong>
          <span>{TIER_LABEL[seg.tier]}</span>
          <span>{formatTime(len)}</span>
        </span>
        <span
          class="edge end"
          aria-hidden="true"
          title="Drag to trim the end"
          onpointerdown={(e) => startTrim(e, i, 'end')}
          onpointermove={(e) => moveTrim(e, i)}
          onpointerup={endTrim}
          onpointercancel={endTrim}
        ></span>
      </div>
    {/each}
  </div>
  <div class="zones">
    <div
      class="zone"
      role="group"
      aria-label="Drop here to repeat"
      ondragover={(e) => dragging && e.preventDefault()}
      ondrop={(e) => dropOn(e, 'duplicate')}
    >
      Drop to repeat
    </div>
    <div
      class="zone remove"
      role="group"
      aria-label="Drop here to remove from the class order"
      ondragover={(e) => dragging && e.preventDefault()}
      ondrop={(e) => dropOn(e, 'remove')}
    >
      Drop to remove
    </div>
  </div>
</section>

<style>
  .strip {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    padding: 4px 0 8px;
  }
  .tile {
    position: relative;
    flex: none;
    min-height: 76px;
    border-radius: var(--radius);
    border: 2px solid transparent;
    display: flex;
    cursor: grab;
    user-select: none;
  }
  .tile.selected {
    border-color: var(--text);
  }
  .tile.drop-before {
    box-shadow: -4px 0 0 0 var(--accent);
  }
  .tile.drop-end {
    box-shadow: 4px 0 0 0 var(--accent);
  }
  .pick {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 22px;
    height: 22px;
    margin: 0;
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 0 10px 4px;
    font-size: 0.8rem;
    overflow: hidden;
  }
  .body strong {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .edge {
    width: 12px;
    flex: none;
    cursor: ew-resize;
    touch-action: none;
    background: rgb(0 0 0 / 0.25);
  }
  .edge.start {
    border-radius: 6px 0 0 6px;
  }
  .edge.end {
    border-radius: 0 6px 6px 0;
  }
  .zones {
    display: flex;
    gap: 8px;
  }
  .zone {
    flex: 1;
    text-align: center;
    padding: 10px;
    border: 2px dashed var(--border);
    border-radius: var(--radius);
    color: var(--muted);
  }
  .zone.remove {
    border-color: var(--danger);
  }
</style>
