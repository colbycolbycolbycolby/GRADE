from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

ANALYZER_VERSION = 1


@dataclass(frozen=True)
class SectionInfo:
    kind: str  # "intro" | "outro" | "section"
    similar_to: int | None = None  # index of the earliest section this one sounds like


@dataclass(frozen=True)
class Analysis:
    """Mirrors the Analysis schema in packages/schema. All times are original-file seconds."""

    track_id: str
    version: int
    duration: float
    energy: list[tuple[float, float]]
    boundaries: list[float]
    structure: list[SectionInfo]
    crop_start: float
    crop_end: float
    created_at: str
    bpm: float | None = None
    beats: list[float] | None = None
    downbeats: list[float] | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "trackId": self.track_id,
            "version": self.version,
            "duration": self.duration,
            "energy": [{"t": t, "e": e} for t, e in self.energy],
            "boundaries": self.boundaries,
            "structure": [
                {
                    "kind": s.kind,
                    **({"similarTo": s.similar_to} if s.similar_to is not None else {}),
                }
                for s in self.structure
            ],
            "cropStart": self.crop_start,
            "cropEnd": self.crop_end,
            "createdAt": self.created_at,
        }
        if self.bpm is not None:
            out["bpm"] = self.bpm
        if self.beats is not None:
            out["beats"] = self.beats
        if self.downbeats is not None:
            out["downbeats"] = self.downbeats
        return out


class Analyzer(Protocol):
    def analyze(
        self, wav_path: str, progress: Callable[[float], None] | None = None
    ) -> Analysis: ...
