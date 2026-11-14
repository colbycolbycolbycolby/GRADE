/** Constants come from Appendix A.3 of architecture.md. */
export const GLITCH_LOOKAHEAD_SEC = 0.35;
export const GLITCH_GRAIN_SEC = 0.14;
export const GLITCH_REPEATS = 6;
export const GLITCH_ATTACK_SEC = 0.008;

export interface GlitchGrain {
  /** Audio clock time to start this grain. */
  when: number;
  /** Peak gain. The gain falls linearly to 0 over one grain length. */
  peak: number;
}

/** Grains to play for a cut at audio time `cutAt`. Grains that would start before `now` are dropped. */
export function glitchPlan(cutAt: number, now: number): GlitchGrain[] {
  const grains: GlitchGrain[] = [];
  let when = cutAt - GLITCH_LOOKAHEAD_SEC;
  for (let i = 0; i < GLITCH_REPEATS; i++) {
    if (when >= now) grains.push({ when, peak: Math.max(0.35, 0.95 - 0.1 * i) });
    when += GLITCH_GRAIN_SEC * Math.max(0.55, 0.92 - 0.05 * i);
  }
  return grains;
}

/** Equal-power fade curves: `out[i]^2 + in[i]^2 = 1`. */
export function equalPowerCurves(points = 32): { fadeOut: Float32Array; fadeIn: Float32Array } {
  const fadeOut = new Float32Array(points);
  const fadeIn = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = i / (points - 1);
    fadeOut[i] = Math.cos((x * Math.PI) / 2);
    fadeIn[i] = Math.sin((x * Math.PI) / 2);
  }
  return { fadeOut, fadeIn };
}
