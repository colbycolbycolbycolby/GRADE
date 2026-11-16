from __future__ import annotations

import json
import math
import sqlite3
from pathlib import Path
from statistics import fmean, pstdev
from typing import Any

from .models import CatalogSong


class CatalogRepository:
    """Read-only view of analyzed songs. It deliberately owns no ingest or analysis behavior."""

    def __init__(self, data_dir: Path) -> None:
        self._db_path = data_dir / "grade.sqlite3"

    def search(self, artist: str | None = None) -> list[CatalogSong]:
        if not self._db_path.is_file():
            return []
        uri = f"file:{self._db_path}?mode=ro"
        with sqlite3.connect(uri, uri=True, timeout=10) as db:
            rows = db.execute(
                """
                SELECT t.id, t.title, t.source, t.duration, a.body
                FROM tracks AS t
                JOIN analyses AS a ON a.track_id = t.id
                ORDER BY lower(t.title), t.id
                """
            ).fetchall()
        songs = [self._song(row) for row in rows]
        if artist:
            needle = artist.casefold().strip()
            songs = [song for song in songs if needle in song.title.casefold()]
        return songs

    @staticmethod
    def _song(row: tuple[Any, ...]) -> CatalogSong:
        body = json.loads(row[4])
        energies = [
            float(point["e"])
            for point in body.get("energy", [])
            if isinstance(point, dict) and math.isfinite(float(point.get("e", 0)))
        ]
        ordered = sorted(energies)
        peak_index = max(0, math.ceil(len(ordered) * 0.9) - 1)
        return CatalogSong(
            track_id=str(row[0]),
            title=str(row[1]),
            source=str(row[2]),
            duration=float(row[3]),
            bpm=float(body["bpm"]) if body.get("bpm") is not None else None,
            mean_energy=fmean(energies) if energies else 0.0,
            peak_energy=ordered[peak_index] if ordered else 0.0,
            energy_variation=pstdev(energies) if len(energies) > 1 else 0.0,
            boundary_count=len(body.get("boundaries", [])),
            section_count=len(body.get("structure", [])),
        )

    def ids(self) -> set[str]:
        return {song.track_id for song in self.search()}
