from __future__ import annotations

import logging
import threading
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from ingest import IngestError

log = logging.getLogger(__name__)

Work = Callable[[Callable[[float], None]], None]
KEEP_FINISHED = 200


class TooManyJobs(Exception):
    pass


@dataclass
class Job:
    id: str
    track_id: str
    status: str = "queued"  # queued | running | done | error
    progress: float = 0.0
    error: tuple[str, str] | None = None  # (code, message)

    def to_dict(self) -> dict[str, object]:
        out: dict[str, object] = {
            "status": self.status,
            "progress": self.progress,
            "trackId": self.track_id,
        }
        if self.error is not None:
            out["error"] = {"code": self.error[0], "message": self.error[1]}
        return out


class JobQueue:
    """In-process worker pool. At most `max_active` jobs are queued or running at once."""

    def __init__(self, workers: int = 2, max_active: int = 2) -> None:
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="grade-job")
        self._max_active = max_active
        self._lock = threading.Lock()
        self._jobs: dict[str, Job] = {}
        self._active_by_track: dict[str, str] = {}

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def finished(self, track_id: str) -> Job:
        """Record a job that is already done, for a cache hit."""
        job = Job(id=uuid.uuid4().hex, track_id=track_id, status="done", progress=1.0)
        with self._lock:
            self._remember(job)
        return job

    def active_for(self, track_id: str) -> Job | None:
        with self._lock:
            job_id = self._active_by_track.get(track_id)
            return self._jobs.get(job_id) if job_id else None

    def submit(self, track_id: str, work: Work) -> tuple[Job, bool]:
        """Start `work`. Return the job and whether it is new.

        If a job for the same track is active, return it with `False` and do not run `work`.
        Raise `TooManyJobs` when `max_active` jobs are active.
        """
        with self._lock:
            job_id = self._active_by_track.get(track_id)
            if job_id is not None:
                return self._jobs[job_id], False
            if len(self._active_by_track) >= self._max_active:
                raise TooManyJobs
            job = Job(id=uuid.uuid4().hex, track_id=track_id)
            self._remember(job)
            self._active_by_track[track_id] = job.id
        self._pool.submit(self._run, job, work)
        return job, True

    def _remember(self, job: Job) -> None:
        self._jobs[job.id] = job
        done = [j.id for j in self._jobs.values() if j.status in ("done", "error")]
        for old in done[: max(0, len(done) - KEEP_FINISHED)]:
            del self._jobs[old]

    def _run(self, job: Job, work: Work) -> None:
        def progress(p: float) -> None:
            job.progress = min(max(p, job.progress), 0.99)

        job.status = "running"
        try:
            work(progress)
        except IngestError as exc:
            job.error = (exc.code, exc.message)
            job.status = "error"
        except Exception:
            log.exception("job %s failed", job.id)
            job.error = ("analysis_failed", "The analysis failed.")
            job.status = "error"
        else:
            job.progress = 1.0
            job.status = "done"
        finally:
            with self._lock:
                self._active_by_track.pop(job.track_id, None)

    def shutdown(self) -> None:
        self._pool.shutdown(wait=True, cancel_futures=True)
