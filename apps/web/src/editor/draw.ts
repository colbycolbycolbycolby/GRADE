import type { Tier } from '@grade/schema';

export interface DrawInput {
  width: number;
  height: number;
  /** Crop-relative times. */
  energy: { t: number; e: number }[];
  duration: number;
  segments: { start: number; end: number; tier: Tier }[];
  selectedIndex: number;
  colors: Record<Tier, string>;
  selectedOutline: string;
}

/** CSS variables for the tier colors, read at draw time so dark mode applies. */
export function readTierColors(el: Element): Record<Tier, string> {
  const css = getComputedStyle(el);
  const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    easy: get('--tier-easy', '#7fc8a9'),
    moderate: get('--tier-moderate', '#f2d16b'),
    hard: get('--tier-hard', '#f0953f'),
    allout: get('--tier-allout', '#e5534b'),
  };
}

/** Draws one bar per pixel column, colored by the tier of the segment at that time. */
export function drawWaveform(ctx: CanvasRenderingContext2D, input: DrawInput): void {
  const { width, height, energy, duration, segments, colors } = input;
  ctx.clearRect(0, 0, width, height);
  if (width <= 0 || duration <= 0) return;
  const mid = height / 2;
  for (let x = 0; x < width; x++) {
    const t0 = (x / width) * duration;
    const t1 = ((x + 1) / width) * duration;
    let peak = 0;
    for (const p of energy) {
      if (p.t >= t1) break;
      if (p.t >= t0 && p.e > peak) peak = p.e;
    }
    const seg = segments.find((s) => t0 >= s.start && t0 < s.end) ?? segments[segments.length - 1];
    if (!seg) continue;
    const h = Math.max(2, peak * (height - 8));
    ctx.fillStyle = colors[seg.tier];
    ctx.fillRect(x, mid - h / 2, 1, h);
  }
  const sel = segments[input.selectedIndex];
  if (sel) {
    const x0 = (sel.start / duration) * width;
    const x1 = (sel.end / duration) * width;
    const selectedWidth = Math.max(x1 - x0, 1);
    ctx.save();
    ctx.fillStyle = input.selectedOutline;
    ctx.globalAlpha = 0.08;
    ctx.fillRect(x0, 0, selectedWidth, height);
    ctx.globalAlpha = 0.75;
    ctx.fillRect(x0, height - 3, selectedWidth, 3);
    ctx.restore();
  }
}
