from __future__ import annotations

import dataclasses
from collections.abc import Callable
from pathlib import Path

from analysis import ANALYZER_VERSION, Analyzer
from ingest import AudioIngest, IngestError, Store, TrackMeta, Transcoder, normalize_url, store_file

from .jobs import Job, JobQueue


class IngestService:
    """Runs the flow of section 6.3: cache check, limits, fetch, analyze, persist."""

    def __init__(
        self,
        store: Store,
        queue: JobQueue,
        ingest: AudioIngest,
        analyzer: Analyzer,
        transcoder: Transcoder,
        max_duration: float,
    ) -> None:
        self._store = store
        self._queue = queue
        self._ingest = ingest
        self._analyzer = analyzer
        self._transcoder = transcoder
        self._max_duration = max_duration

    def is_cached(self, track_id: str) -> bool:
        found = self._store.get_analysis(track_id)
        return (
            found is not None
            and found[0] == ANALYZER_VERSION
            and self._store.get_track(track_id) is not None
            and self._store.stored_audio(track_id) is not None
        )

    def start_youtube(self, url: str) -> Job:
        track_id = f"yt:{normalize_url(url)}"
        if self.is_cached(track_id):
            return self._queue.finished(track_id)

        def work(progress: Callable[[float], None]) -> None:
            known = self._store.get_track(track_id)
            if known is not None:
                meta = TrackMeta(track_id, "youtube", known["title"], known["duration"])
            else:
                meta = self._ingest.resolve(url)
            progress(0.05)
            stored = self._ingest.fetch_audio(track_id)
            self._store.put_track(meta)
            progress(0.4)
            self._analyze(track_id, stored.wav_path, progress)

        return self._queue.submit(track_id, work)[0]

    def start_file(self, track_id: str, upload: Path, title: str) -> Job:
        """`upload` is a temporary copy. The job removes it when it ends."""
        if self.is_cached(track_id):
            upload.unlink(missing_ok=True)
            return self._queue.finished(track_id)

        def work(progress: Callable[[float], None]) -> None:
            try:
                meta, stored = store_file(
                    self._store, self._transcoder, upload, title, self._max_duration
                )
            finally:
                upload.unlink(missing_ok=True)
            self._store.put_track(meta)
            progress(0.4)
            self._analyze(track_id, stored.wav_path, progress)

        try:
            job, created = self._queue.submit(track_id, work)
        except BaseException:
            upload.unlink(missing_ok=True)
            raise
        if not created:
            upload.unlink(missing_ok=True)
        return job

    def _analyze(self, track_id: str, wav_path: Path, progress: Callable[[float], None]) -> None:
        try:
            result = self._analyzer.analyze(str(wav_path), lambda p: progress(0.4 + 0.58 * p))
        except Exception as exc:
            raise IngestError("analysis_failed", "The analysis failed.") from exc
        result = dataclasses.replace(result, track_id=track_id)
        self._store.put_analysis(track_id, result.version, result.to_dict())
