from __future__ import annotations

import json
import re
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

from .models import StoredAudio, TrackMeta

TRACK_ID_RE = re.compile(r"^(file:[0-9a-f]{64}|yt:[A-Za-z0-9_-]{11})$")

PLAY_NAME = "play.m4a"
WAV_NAME = "analysis.wav"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT NOT NULL, duration REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS analyses (
  track_id TEXT PRIMARY KEY, version INTEGER NOT NULL, body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS aliases (
  track_id TEXT NOT NULL, alias TEXT NOT NULL, PRIMARY KEY (track_id, alias)
);
"""


class Store:
    """SQLite metadata plus the audio folder. Audio lives under `root/audio`, never a web folder."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.audio_root = root / "audio"
        self.audio_root.mkdir(parents=True, exist_ok=True)
        self._db_path = root / "grade.sqlite3"
        with self._connect() as db:
            db.executescript(_SCHEMA)

    def _connect(self) -> closing[sqlite3.Connection]:
        db = sqlite3.connect(self._db_path, timeout=30)
        return closing(db)

    def audio_dir(self, track_id: str) -> Path:
        if not TRACK_ID_RE.match(track_id):
            raise ValueError(f"bad track id: {track_id!r}")
        return self.audio_root / track_id.replace(":", "_")

    def stored_audio(self, track_id: str) -> StoredAudio | None:
        folder = self.audio_dir(track_id)
        play, wav = folder / PLAY_NAME, folder / WAV_NAME
        if play.is_file() and wav.is_file():
            return StoredAudio(track_id, play, wav)
        return None

    def put_track(self, meta: TrackMeta) -> None:
        with self._connect() as db:
            db.execute(
                "INSERT OR REPLACE INTO tracks (id, source, title, duration) VALUES (?, ?, ?, ?)",
                (meta.track_id, meta.source, meta.title, meta.duration),
            )
            db.commit()

    def get_track(self, track_id: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute(
                "SELECT id, source, title, duration FROM tracks WHERE id = ?", (track_id,)
            ).fetchone()
            if row is None:
                return None
            aliases = [
                r[0]
                for r in db.execute(
                    "SELECT alias FROM aliases WHERE track_id = ? ORDER BY alias", (track_id,)
                )
            ]
        return {
            "id": row[0],
            "source": row[1],
            "title": row[2],
            "duration": row[3],
            "aliases": aliases,
        }

    def put_analysis(self, track_id: str, version: int, body: dict[str, Any]) -> None:
        with self._connect() as db:
            db.execute(
                "INSERT OR REPLACE INTO analyses (track_id, version, body) VALUES (?, ?, ?)",
                (track_id, version, json.dumps(body)),
            )
            db.commit()

    def get_analysis(self, track_id: str) -> tuple[int, dict[str, Any]] | None:
        with self._connect() as db:
            row = db.execute(
                "SELECT version, body FROM analyses WHERE track_id = ?", (track_id,)
            ).fetchone()
        if row is None:
            return None
        body: dict[str, Any] = json.loads(row[1])
        return int(row[0]), body
