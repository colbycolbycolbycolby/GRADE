from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime

import librosa

from .beats import snap_boundaries, track_beats
from .energy import detect_trim_range, energy_curve
from .features import combine_features, structure_features
from .models import ANALYZER_VERSION, Analysis, SectionInfo
from .structure import detect_structure, energy_per_frame, fallback_boundaries

SAMPLE_RATE = 22050


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class LibrosaAnalyzer:
    """Implements the Analyzer protocol. The caller sets `track_id` on the result."""

    def __init__(self, now: Callable[[], str] = _now) -> None:
        self._now = now

    def analyze(self, wav_path: str, progress: Callable[[float], None] | None = None) -> Analysis:
        def report(p: float) -> None:
            if progress is not None:
                progress(min(max(p, 0.0), 1.0))

        report(0.0)
        y, loaded_sr = librosa.load(wav_path, sr=SAMPLE_RATE, mono=True)
        sr = int(loaded_sr)
        duration = len(y) / sr
        report(0.1)

        times, energy, level = energy_curve(y, sr)
        crop_start, crop_end = detect_trim_range(times, level, duration)
        report(0.2)

        bpm, beats, downbeats = track_beats(y, sr)
        report(0.5)

        chroma, texture, hop = structure_features(y, sr)
        features = combine_features(chroma, texture) if len(chroma) else chroma
        frame_energy = energy_per_frame(times, energy, hop, len(features))
        report(0.7)

        def snap(boundaries: list[float]) -> list[float]:
            return snap_boundaries(boundaries, beats, downbeats, bpm)

        found = detect_structure(features, frame_energy, hop, crop_start, crop_end, snap)
        if found is not None:
            boundaries, structure = found
        else:
            boundaries = fallback_boundaries(times, energy, crop_start, crop_end)
            structure = [SectionInfo(kind="section") for _ in range(len(boundaries) + 1)]
        report(1.0)

        return Analysis(
            track_id="",
            version=ANALYZER_VERSION,
            duration=round(duration, 3),
            energy=[(round(float(t), 3), round(float(e), 4)) for t, e in zip(times, energy)],
            boundaries=[round(b, 3) for b in boundaries],
            structure=structure,
            crop_start=round(crop_start, 3),
            crop_end=round(crop_end, 3),
            created_at=self._now(),
            bpm=bpm,
            beats=beats,
            downbeats=downbeats,
        )
