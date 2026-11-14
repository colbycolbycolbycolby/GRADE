"""Tempo, beats, downbeats and boundary snapping."""

from __future__ import annotations

import librosa
import numpy as np
from numpy.typing import NDArray

BEATS_PER_BAR = 4
SNAP_DOWNBEAT_SEC = 1.0
SNAP_BEAT_FRACTION = 0.5


def track_beats(
    y: NDArray[np.float32], sr: int
) -> tuple[float | None, list[float] | None, list[float] | None]:
    """Returns (bpm, beats, downbeats). Downbeats assume 4/4: the bar phase with the strongest onsets."""
    tempo, beat_times = librosa.beat.beat_track(y=y, sr=sr, units="time")
    beats = [float(b) for b in beat_times]
    bpm = float(np.atleast_1d(tempo)[0])
    if len(beats) < 2 * BEATS_PER_BAR or bpm <= 0:
        return None, None, None
    onset = librosa.onset.onset_strength(y=y, sr=sr)
    frames = librosa.time_to_frames(beat_times, sr=sr)
    strength = onset[np.clip(frames, 0, len(onset) - 1)]
    phase_scores = [float(strength[p::BEATS_PER_BAR].mean()) for p in range(BEATS_PER_BAR)]
    phase = int(np.argmax(phase_scores))
    downbeats = beats[phase::BEATS_PER_BAR]
    return round(bpm, 2), [round(b, 3) for b in beats], [round(b, 3) for b in downbeats]


def snap_boundaries(
    boundaries: list[float],
    beats: list[float] | None,
    downbeats: list[float] | None,
    bpm: float | None,
) -> list[float]:
    """Moves each boundary to the nearest downbeat (within 1 s), else the nearest beat (within half a beat)."""
    if not beats or not bpm:
        return boundaries
    period = 60.0 / bpm
    out: list[float] = []
    for b in boundaries:
        target = b
        if downbeats:
            nearest = min(downbeats, key=lambda d: abs(d - b))
            if abs(nearest - b) <= SNAP_DOWNBEAT_SEC:
                out.append(nearest)
                continue
        nearest = min(beats, key=lambda d: abs(d - b))
        if abs(nearest - b) <= period * SNAP_BEAT_FRACTION:
            target = nearest
        out.append(target)
    return sorted(set(out))
