from __future__ import annotations

import argparse
import csv
import re
import sqlite3
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO

from ingest import IngestError, RealYtDlp, YtDlpSearchClient, normalize_url

from .app import Settings

REVIEW_FIELDS = (
    "entry",
    "artist",
    "song",
    "rank",
    "status",
    "cautions",
    "candidate_title",
    "channel",
    "duration",
    "url",
    "approved",
)
CAUTION_PATTERNS = {
    "live": re.compile(r"\b(live|concert|performance|session|tour)\b", re.IGNORECASE),
    "cover": re.compile(r"\b(cover|tribute|karaoke)\b", re.IGNORECASE),
    "remix": re.compile(r"\b(remix|rework|mashup|bootleg|edit)\b", re.IGNORECASE),
}
APPROVED_VALUES = {"yes", "y", "true", "1", "approved"}


@dataclass(frozen=True)
class CatalogEntry:
    line_number: int
    artist: str
    song: str


def read_catalog(path: Path) -> list[CatalogEntry]:
    entries: list[CatalogEntry] = []
    with path.open(encoding="utf-8-sig") as catalog_file:
        for line_number, raw in enumerate(catalog_file, start=1):
            text = raw.strip()
            if not text or text.startswith("#"):
                continue
            parts = re.split(r"\s+-\s+", text, maxsplit=1)
            if len(parts) != 2 or not all(part.strip() for part in parts):
                raise ValueError(f"line {line_number}: expected Artist - Song Title")
            entries.append(CatalogEntry(line_number, parts[0].strip(), parts[1].strip()))
    return entries


def normalized_title(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", value.casefold()))


def read_library_titles(data_dir: Path) -> set[str]:
    """Read titles without creating or changing the database."""
    database = data_dir / "grade.sqlite3"
    if not database.is_file():
        return set()
    connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
    try:
        rows = connection.execute("SELECT title FROM tracks").fetchall()
    except sqlite3.OperationalError:
        return set()
    finally:
        connection.close()
    return {normalized_title(str(row[0])) for row in rows}


def is_in_library(entry: CatalogEntry, titles: set[str]) -> bool:
    song = normalized_title(entry.song)
    artist = normalized_title(entry.artist)
    artist_song = normalized_title(f"{entry.artist} {entry.song}")
    song_artist = normalized_title(f"{entry.song} {entry.artist}")
    return any(
        title in (song, artist_song, song_artist) or (song in title and artist in title)
        for title in titles
    )


def caution_flags(candidate: dict[str, object]) -> tuple[str, ...]:
    title = str(candidate.get("title") or "")
    channel = str(candidate.get("channel") or candidate.get("uploader") or "")
    combined = f"{title} {channel}"
    flags = [name for name, pattern in CAUTION_PATTERNS.items() if pattern.search(combined)]
    if (
        candidate.get("is_live") or candidate.get("live_status") in ("is_live", "was_live")
    ) and "live" not in flags:
        flags.append("live")
    duration = candidate.get("duration")
    if not isinstance(duration, (int, float)) or duration <= 0:
        flags.append("unknown-duration")
    elif duration > 15 * 60:
        flags.append("over-15-minutes")
    return tuple(flags)


def candidate_url(candidate: dict[str, object]) -> str:
    video_id = str(candidate.get("id") or "")
    url = str(candidate.get("webpage_url") or candidate.get("url") or "")
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        return f"https://www.youtube.com/watch?v={video_id}"
    try:
        normalized = normalize_url(url)
    except IngestError:
        return ""
    return f"https://www.youtube.com/watch?v={normalized}"


def prepare_review(
    entries: Sequence[CatalogEntry],
    output_path: Path,
    data_dir: Path,
    search_client: YtDlpSearchClient,
    *,
    candidate_count: int = 5,
    output: TextIO = sys.stdout,
) -> tuple[int, int, int]:
    library_titles = read_library_titles(data_dir)
    searched = skipped = errors = 0
    with output_path.open("w", encoding="utf-8", newline="") as review_file:
        writer = csv.DictWriter(review_file, fieldnames=REVIEW_FIELDS, delimiter="\t")
        writer.writeheader()
        for index, entry in enumerate(entries, start=1):
            common = {"entry": index, "artist": entry.artist, "song": entry.song, "approved": ""}
            if is_in_library(entry, library_titles):
                skipped += 1
                writer.writerow({**common, "status": "already_in_library"})
                print(f"[{index}/{len(entries)}] SKIP {entry.artist} - {entry.song}", file=output)
                continue
            print(f"[{index}/{len(entries)}] SEARCH {entry.artist} - {entry.song}", file=output)
            try:
                candidates = search_client.search(
                    f'"{entry.artist}" "{entry.song}" official audio', candidate_count
                )
            except Exception as exc:  # noqa: BLE001 - one failed search must not stop the catalog
                errors += 1
                writer.writerow({**common, "status": "search_error", "cautions": str(exc)})
                continue
            searched += 1
            written = 0
            for candidate in candidates:
                url = candidate_url(candidate)
                if not url:
                    continue
                written += 1
                duration = candidate.get("duration")
                writer.writerow(
                    {
                        **common,
                        "rank": written,
                        "status": "candidate",
                        "cautions": ",".join(caution_flags(candidate)),
                        "candidate_title": candidate.get("title") or "",
                        "channel": candidate.get("channel") or candidate.get("uploader") or "",
                        "duration": format_duration(duration),
                        "url": url,
                    }
                )
            if written == 0:
                errors += 1
                writer.writerow({**common, "status": "no_candidates"})
    print(
        f"SUMMARY catalog={len(entries)} searched={searched} "
        f"library_skips={skipped} search_errors={errors}",
        file=output,
    )
    return searched, skipped, errors


def format_duration(value: object) -> str:
    if not isinstance(value, (int, float)) or value <= 0:
        return ""
    seconds = round(value)
    return f"{seconds // 60}:{seconds % 60:02d}"


def export_approved(review_path: Path, manifest_path: Path) -> int:
    selected: dict[str, str] = {}
    with review_path.open(encoding="utf-8-sig", newline="") as review_file:
        reader = csv.DictReader(review_file, delimiter="\t")
        missing = set(REVIEW_FIELDS) - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"review file is missing columns: {', '.join(sorted(missing))}")
        for line_number, row in enumerate(reader, start=2):
            if (row.get("approved") or "").strip().casefold() not in APPROVED_VALUES:
                continue
            if row.get("status") != "candidate":
                raise ValueError(f"line {line_number}: only candidate rows can be approved")
            entry = row["entry"]
            if entry in selected:
                raise ValueError(f"line {line_number}: entry {entry} has more than one approval")
            video_id = normalize_url(row["url"])
            selected[entry] = f"https://www.youtube.com/watch?v={video_id}"
    with manifest_path.open("w", encoding="utf-8") as manifest:
        for url in selected.values():
            manifest.write(f"{url}\n")
    return len(selected)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Prepare and approve YouTube sources for GRADE.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    search = subparsers.add_parser("search", help="search metadata and write a review TSV")
    search.add_argument("catalog", type=Path)
    search.add_argument("review", type=Path)
    search.add_argument("--data-dir", type=Path)
    search.add_argument("--candidates", type=int, default=5, choices=range(1, 11))
    approve = subparsers.add_parser("approve", help="export approved rows to a URL manifest")
    approve.add_argument("review", type=Path)
    approve.add_argument("manifest", type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "search":
            entries = read_catalog(args.catalog)
            if not entries:
                raise ValueError("the catalog contains no songs")
            settings = Settings.from_env()
            data_dir = args.data_dir if args.data_dir is not None else settings.data_dir
            _, _, errors = prepare_review(
                entries,
                args.review,
                data_dir,
                RealYtDlp(),
                candidate_count=args.candidates,
            )
            print(f"Review {args.review}, set approved=yes on one candidate per song, then export.")
            return 1 if errors else 0
        count = export_approved(args.review, args.manifest)
        print(f"Wrote {count} approved URLs to {args.manifest}")
        return 0
    except (OSError, ValueError, IngestError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
