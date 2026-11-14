"""Chroma and coarse texture features, one frame per 0.5 s (architecture.md Appendix A.1)."""

from __future__ import annotations

import librosa
import numpy as np
from numpy.typing import NDArray

WINDOW_SEC = 0.5
OCTAVE_MIN_MIDI = 48  # octave 3, C
OCTAVE_MAX_MIDI = 83  # octave 5, B
TEXTURE_HZ = (200.0, 800.0, 3000.0)
TEXTURE_WEIGHT = 0.6


def structure_features(
    y: NDArray[np.float32], sr: int
) -> tuple[NDArray[np.float64], NDArray[np.float64], float]:
    """Returns (chroma [F,12], texture [F,3], hop seconds). Frame i covers [i*hop, (i+1)*hop)."""
    n = int(sr * WINDOW_SEC)
    hop = n / sr
    if len(y) < n:
        return np.zeros((0, 12)), np.zeros((0, 3)), hop
    spec = np.abs(librosa.stft(y, n_fft=n, hop_length=n, center=False, window="hann"))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n)
    chroma = np.zeros((spec.shape[1], 12))
    valid = freqs > 0
    midi = np.zeros_like(freqs)
    midi[valid] = 12 * np.log2(freqs[valid] / 440.0) + 69
    rounded = np.rint(midi).astype(int)
    for b in np.nonzero(valid & (rounded >= OCTAVE_MIN_MIDI) & (rounded <= OCTAVE_MAX_MIDI))[0]:
        chroma[:, rounded[b] % 12] += spec[b]
    texture = np.stack([spec[round(f * n / sr)] for f in TEXTURE_HZ], axis=1)
    return chroma, texture, hop


def combine_features(
    chroma: NDArray[np.float64], texture: NDArray[np.float64]
) -> NDArray[np.float64]:
    """Normalized chroma plus normalized texture scaled by 0.6."""

    def unit(m: NDArray[np.float64]) -> NDArray[np.float64]:
        norm = np.linalg.norm(m, axis=1, keepdims=True)
        norm[norm == 0] = 1.0
        return m / norm

    return np.concatenate([unit(chroma), unit(texture) * TEXTURE_WEIGHT], axis=1)
