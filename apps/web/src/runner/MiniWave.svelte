<script lang="ts">
  import { onMount } from 'svelte';
  import type { EnergyPoint } from './energy';

  interface Props {
    energy: EnergyPoint[];
    total: number;
    classTime: number;
    /** Class times where a block starts. */
    boundaries: number[];
  }
  let { energy, total, classTime, boundaries }: Props = $props();

  let canvas: HTMLCanvasElement;
  let width = $state(0);
  const HEIGHT = 56;

  function draw() {
    const ctx = canvas?.getContext('2d');
    if (!ctx || width <= 0 || total <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);
    const color = getComputedStyle(canvas).color;
    const playedX = (classTime / total) * width;
    const mid = HEIGHT / 2;
    let i = 0;
    for (let x = 0; x < width; x++) {
      const t1 = ((x + 1) / width) * total;
      let peak = 0;
      for (; i < energy.length && energy[i]!.t < t1; i++) peak = Math.max(peak, energy[i]!.e);
      const h = Math.max(2, peak * (HEIGHT - 6));
      ctx.globalAlpha = x < playedX ? 1 : 0.35;
      ctx.fillStyle = color;
      ctx.fillRect(x, mid - h / 2, 1, h);
    }
    ctx.globalAlpha = 0.6;
    for (const b of boundaries) ctx.fillRect(Math.round((b / total) * width), 0, 1, HEIGHT);
    ctx.globalAlpha = 1;
    ctx.fillRect(Math.round(playedX) - 1, 0, 3, HEIGHT);
  }

  onMount(() => {
    width = canvas.clientWidth;
    const observer = new ResizeObserver(() => (width = canvas.clientWidth));
    observer.observe(canvas);
    return () => observer.disconnect();
  });

  $effect(() => {
    // Read every input so the effect runs again when one changes.
    void [energy, total, classTime, boundaries, width];
    draw();
  });
</script>

<canvas bind:this={canvas} style="height: {HEIGHT}px" aria-hidden="true"></canvas>

<style>
  canvas {
    width: 100%;
    display: block;
    color: inherit;
  }
</style>
