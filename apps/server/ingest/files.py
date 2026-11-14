from __future__ import annotations

import hashlib
import shutil
import tempfile
from pathlib import Path

from .models import MAX_DURATION_SEC, IngestError, StoredAudio, TrackMeta
from .store import PLAY_NAME, WAV_NAME, Store
from .transcode import Transcoder


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def store_file(
    store: Store,
    transcoder: Transcoder,
    source: Path,
    title: str,
    max_duration: float = MAX_DURATION_SEC,
) -> tuple[TrackMeta, StoredAudio]:
    """Check the length, then keep a playback copy and an analysis WAV, keyed by content hash."""
    track_id = f"file:{hash_file(source)}"
    duration = transcoder.duration(source)
    if duration > max_duration:
        raise IngestError("too_long", f"The file is longer than {int(max_duration // 60)} minutes.")
    meta = TrackMeta(track_id=track_id, source="file", title=title, duration=duration)
    existing = store.stored_audio(track_id)
    if existing is not None:
        return meta, existing
    folder = store.audio_dir(track_id)
    with tempfile.TemporaryDirectory(dir=store.root) as tmp:
        staging = Path(tmp) / "out"
        transcoder.transcode(source, staging / PLAY_NAME, staging / WAV_NAME)
        if folder.exists():
            shutil.rmtree(folder)
        shutil.move(str(staging), str(folder))
    return meta, StoredAudio(track_id, folder / PLAY_NAME, folder / WAV_NAME)
