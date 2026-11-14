"""Energy curve and silence trim. Constants follow architecture.md Appendix A.1."""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

FRAME_SEC = 0.25
HOP_SEC = 0.1
SMOOTH_FRAMES = 12
SILENCE_THRESHOLD = 0.05
MIN_SILENCE_SEC = 1.0
MIN_KEEP_SEC = 10.0


def smoothed_rms(
    y: NDArray[np.float32], sr: int
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """RMS per 0.25 s frame every 0.1 s, then a trailing moving average over 12 frames."""
    frame = int(sr * FRAME_SEC)
    hop = int(sr * HOP_SEC)
    if len(y) < frame:
        return np.zeros(0), np.zeros(0)
    csum = np.concatenate([[0.0], np.cumsum(y.astype(np.float64) ** 2)])
    starts = np.arange(0, len(y) - frame + 1, hop)
    rms = np.sqrt((csum[starts + frame] - csum[starts]) / frame)
    window = np.minimum(np.arange(1, len(rms) + 1), SMOOTH_FRAMES)
    cs = np.concatenate([[0.0], np.cumsum(rms)])
    idx = np.arange(len(rms))
    lo = np.maximum(idx + 1 - SMOOTH_FRAMES, 0)
    return starts / sr, (cs[idx + 1] - cs[lo]) / window


def energy_curve(
    y: NDArray[np.float32], sr: int
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    """Returns (times, energy, level). Energy is min-max normalized to 0..1, about 10 points/sec.

    `level` is the same curve divided by its maximum (zero floor). Silence is judged on `level`:
    on the min-max curve a quiet intro would read as 0 and be trimmed as silence.
    """
    times, smoothed = smoothed_rms(y, sr)
    if len(smoothed) == 0:
        return times, smoothed, smoothed
    rng = float(smoothed.max() - smoothed.min()) or 1.0
    top = float(smoothed.max()) or 1.0
    return times, (smoothed - smoothed.min()) / rng, smoothed / top


def detect_trim_range(
    times: NDArray[np.float64], e: NDArray[np.float64], duration: float
) -> tuple[float, float]:
    """Trim leading and trailing silence (level < 0.05 for at least 1 s). Keep at least 10 s."""
    crop_start, crop_end = 0.0, duration
    n = len(e)
    if n == 0:
        return crop_start, crop_end
    i = 0
    while i < n and e[i] < SILENCE_THRESHOLD:
        i += 1
    if 0 < i < n and times[i] >= MIN_SILENCE_SEC:
        crop_start = float(times[max(0, i - 1)])
    j = n - 1
    while j >= 0 and e[j] < SILENCE_THRESHOLD:
        j -= 1
    if 0 <= j < n - 1 and duration - times[j] >= MIN_SILENCE_SEC:
        crop_end = float(times[min(n - 1, j + 1)])
    if crop_end - crop_start < MIN_KEEP_SEC or crop_end <= crop_start:
        return 0.0, duration
    return crop_start, crop_end
