from __future__ import annotations

import argparse
import sys
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO

from analysis import LibrosaAnalyzer
from ingest import FfmpegTranscoder, IngestError, Store, YtDlpIngest, normalize_url

from .app import Settings
from .jobs import Job, JobQueue
from .service import IngestService

POLL_INTERVAL_SEC = 0.25


@dataclass(frozen=True)
class BatchResult:
    total: int
    succeeded: tuple[str, ...]
    skipped: tuple[str, ...]
    errors: tuple[tuple[str, str, str], ...]


def read_sources(path: Path) -> list[tuple[int, str]]:
    """Read non-empty, non-comment source lines, retaining their file line numbers."""
    with path.open(encoding="utf-8-sig") as source_file:
        return [
            (line_number, line.strip())
            for line_number, line in enumerate(source_file, start=1)
            if line.strip() and not line.lstrip().startswith("#")
        ]


def run_batch(
    sources: Sequence[tuple[int, str]],
    service: IngestService,
    *,
    output: TextIO = sys.stdout,
    poll_interval: float = POLL_INTERVAL_SEC,
    sleep: Callable[[float], None] = time.sleep,
) -> BatchResult:
    """Ingest sources one at a time and continue after per-source failures."""
    succeeded: list[str] = []
    skipped: list[str] = []
    errors: list[tuple[str, str, str]] = []
    total = len(sources)

    for position, (line_number, url) in enumerate(sources, start=1):
        prefix = f"[{position}/{total}] line {line_number}"
        try:
            track_id = f"yt:{normalize_url(url)}"
            if service.is_cached(track_id):
                skipped.append(track_id)
                print(f"{prefix} SKIP {track_id} (already analyzed)", file=output, flush=True)
                continue

            print(f"{prefix} START {track_id}", file=output, flush=True)
            job = service.start_youtube(url)
            _wait_for_job(job, prefix, output, poll_interval, sleep)
            if job.status == "done":
                succeeded.append(track_id)
                print(f"{prefix} OK {track_id}", file=output, flush=True)
            else:
                code, message = job.error or ("unknown_error", "The job failed.")
                errors.append((url, code, message))
                print(f"{prefix} ERROR {track_id} [{code}] {message}", file=output, flush=True)
        except IngestError as exc:
            errors.append((url, exc.code, exc.message))
            print(f"{prefix} ERROR [{exc.code}] {exc.message}", file=output, flush=True)
        # A malformed source or unexpected library failure must not stop the remaining batch.
        except Exception as exc:  # noqa: BLE001
            errors.append((url, "unexpected_error", str(exc)))
            print(f"{prefix} ERROR [unexpected_error] {exc}", file=output, flush=True)

    result = BatchResult(total, tuple(succeeded), tuple(skipped), tuple(errors))
    _print_summary(result, output)
    return result


def _wait_for_job(
    job: Job,
    prefix: str,
    output: TextIO,
    poll_interval: float,
    sleep: Callable[[float], None],
) -> None:
    last_percent = -1
    while job.status not in ("done", "error"):
        percent = int(job.progress * 100)
        if percent != last_percent:
            print(f"{prefix} PROGRESS {percent}%", file=output, flush=True)
            last_percent = percent
        sleep(poll_interval)


def _print_summary(result: BatchResult, output: TextIO) -> None:
    print(
        "SUMMARY "
        f"total={result.total} succeeded={len(result.succeeded)} "
        f"skipped={len(result.skipped)} errors={len(result.errors)}",
        file=output,
        flush=True,
    )
    for url, code, message in result.errors:
        print(f"ERROR {url} [{code}] {message}", file=output, flush=True)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Sequentially ingest and analyze YouTube sources using the GRADE pipeline."
    )
    parser.add_argument("sources", type=Path, help="UTF-8 text file with one source URL per line")
    parser.add_argument(
        "--data-dir",
        type=Path,
        help="GRADE data directory (default: GRADE_DATA_DIR or ./data)",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = Settings.from_env()
    data_dir = args.data_dir if args.data_dir is not None else settings.data_dir
    try:
        sources = read_sources(args.sources)
    except OSError as exc:
        print(f"Cannot read source file: {exc}", file=sys.stderr)
        return 2
    if not sources:
        print("No sources found in the input file.", file=sys.stderr)
        return 2

    store = Store(data_dir)
    transcoder = FfmpegTranscoder()
    queue = JobQueue(workers=1, max_active=1)
    service = IngestService(
        store,
        queue,
        YtDlpIngest(store, transcoder=transcoder, max_duration=settings.max_duration),
        LibrosaAnalyzer(),
        transcoder,
        settings.max_duration,
    )
    try:
        result = run_batch(sources, service)
    finally:
        queue.shutdown()
    return 1 if result.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
