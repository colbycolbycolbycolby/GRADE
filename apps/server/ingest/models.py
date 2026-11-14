from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

MAX_DURATION_SEC = 15 * 60


class IngestError(Exception):
    """A failure with a code from `ERROR_CODES` in packages/schema."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class TrackMeta:
    track_id: str
    source: str  # "file" | "youtube"
    title: str
    duration: float


@dataclass(frozen=True)
class StoredAudio:
    """Paths of the stored copies: a compressed copy for playback and a mono WAV for analysis."""

    track_id: str
    play_path: Path
    wav_path: Path


class AudioIngest(Protocol):
    def resolve(self, url: str) -> TrackMeta: ...
    def fetch_audio(self, track_id: str) -> StoredAudio: ...
