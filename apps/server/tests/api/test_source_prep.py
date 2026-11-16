from __future__ import annotations

import csv
import io
from pathlib import Path
from typing import Any

import pytest

from api.source_prep import (
    CatalogEntry,
    caution_flags,
    export_approved,
    prepare_review,
    read_catalog,
)
from ingest import Store, TrackMeta


class FakeSearch:
    def __init__(self) -> None:
        self.queries: list[tuple[str, int]] = []

    def search(self, query: str, limit: int) -> list[dict[str, Any]]:
        self.queries.append((query, limit))
        return [
            {
                "id": "AAAAAAAAAAA",
                "title": "New Song (Official Audio)",
                "channel": "Artist",
                "duration": 183,
            },
            {
                "id": "BBBBBBBBBBB",
                "title": "New Song Live Cover Remix",
                "channel": "Unrelated Karaoke",
                "duration": 245,
                "was_live": True,
            },
        ]


def read_tsv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as source:
        return list(csv.DictReader(source, delimiter="\t"))


def write_tsv(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=rows[0].keys(), delimiter="\t")
        writer.writeheader()
        writer.writerows(rows)


def test_catalog_requires_artist_dash_title(tmp_path: Path) -> None:
    catalog = tmp_path / "catalog.txt"
    catalog.write_text("# songs\nArtist - Song - Radio Edit\n")
    assert read_catalog(catalog) == [CatalogEntry(2, "Artist", "Song - Radio Edit")]

    catalog.write_text("missing separator\n")
    with pytest.raises(ValueError, match="line 1"):
        read_catalog(catalog)


def test_prepare_review_skips_library_and_never_preapproves(
    tmp_path: Path,
) -> None:
    store = Store(tmp_path)
    store.put_track(
        TrackMeta("yt:CCCCCCCCCCC", "youtube", "Known Artist - Existing Song (Official Video)", 200)
    )
    search = FakeSearch()
    review = tmp_path / "review.tsv"
    output = io.StringIO()

    result = prepare_review(
        [
            CatalogEntry(1, "Known Artist", "Existing Song"),
            CatalogEntry(2, "New Artist", "New Song"),
        ],
        review,
        tmp_path,
        search,
        candidate_count=2,
        output=output,
    )

    assert result == (1, 1, 0)
    assert search.queries == [('"New Artist" "New Song" official audio', 2)]
    rows = read_tsv(review)
    assert rows[0]["status"] == "already_in_library"
    assert [row["candidate_title"] for row in rows[1:]] == [
        "New Song (Official Audio)",
        "New Song Live Cover Remix",
    ]
    assert rows[1]["duration"] == "3:03"
    assert rows[1]["cautions"] == ""
    assert set(rows[2]["cautions"].split(",")) == {"live", "cover", "remix"}
    assert all(row["approved"] == "" for row in rows)
    assert "library_skips=1" in output.getvalue()


def test_cautions_flag_live_metadata_and_long_or_unknown_duration() -> None:
    assert caution_flags({"title": "Song", "is_live": True, "duration": 901}) == (
        "live",
        "over-15-minutes",
    )
    assert caution_flags({"title": "Song"}) == ("unknown-duration",)


def test_export_only_approved_candidates_and_rejects_multiple(tmp_path: Path) -> None:
    review = tmp_path / "review.tsv"
    manifest = tmp_path / "sources.txt"
    rows = [
        {
            "entry": "1",
            "artist": "Artist",
            "song": "Song",
            "rank": "1",
            "status": "candidate",
            "cautions": "",
            "candidate_title": "Song",
            "channel": "Artist",
            "duration": "3:00",
            "url": "https://youtu.be/AAAAAAAAAAA",
            "approved": "yes",
        },
        {
            "entry": "1",
            "artist": "Artist",
            "song": "Song",
            "rank": "2",
            "status": "candidate",
            "cautions": "cover",
            "candidate_title": "Song Cover",
            "channel": "Other",
            "duration": "3:10",
            "url": "https://youtu.be/BBBBBBBBBBB",
            "approved": "",
        },
    ]
    write_tsv(review, rows)

    assert export_approved(review, manifest) == 1
    assert manifest.read_text() == "https://www.youtube.com/watch?v=AAAAAAAAAAA\n"

    rows[1]["approved"] = "yes"
    write_tsv(review, rows)
    with pytest.raises(ValueError, match="more than one approval"):
        export_approved(review, manifest)
