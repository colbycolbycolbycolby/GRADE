from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import Settings, create_app
from planner import CatalogRepository, PlaylistAgent, RuleBasedRequestInterpreter

TRACKS = [
    ("yt:AAAAAAAAAAA", "Rihanna - Easy Start", 210.0, 92.0, 0.25, 5),
    ("yt:BBBBBBBBBBB", "Rihanna - Rolling Hill", 240.0, 120.0, 0.55, 8),
    ("yt:CCCCCCCCCCC", "Rihanna - Fast Finish", 225.0, 132.0, 0.75, 11),
    ("yt:DDDDDDDDDDD", "Other Artist - Heavy Climb", 260.0, 118.0, 0.9, 7),
    ("yt:EEEEEEEEEEE", "Other Artist - Recovery", 200.0, 84.0, 0.15, 4),
    ("yt:FFFFFFFFFFF", "Other Artist - Wild Card", 230.0, 128.0, 0.65, 15),
]


@pytest.fixture()
def catalog_dir(tmp_path: Path) -> Path:
    db_path = tmp_path / "grade.sqlite3"
    with sqlite3.connect(db_path) as db:
        db.executescript(
            """
            CREATE TABLE tracks (id TEXT PRIMARY KEY, source TEXT, title TEXT, duration REAL);
            CREATE TABLE analyses (track_id TEXT PRIMARY KEY, version INTEGER, body TEXT);
            CREATE TABLE aliases (track_id TEXT, alias TEXT, PRIMARY KEY (track_id, alias));
            """
        )
        for track_id, title, duration, bpm, energy, boundaries in TRACKS:
            body = {
                "trackId": track_id,
                "bpm": bpm,
                "energy": [
                    {"t": 0, "e": max(0, energy - 0.1)},
                    {"t": duration / 2, "e": energy},
                    {"t": duration, "e": min(1, energy + 0.1)},
                ],
                "boundaries": list(range(boundaries)),
                "structure": [{"kind": "section"}] * (boundaries + 1),
            }
            db.execute(
                "INSERT INTO tracks VALUES (?, 'youtube', ?, ?)", (track_id, title, duration)
            )
            db.execute("INSERT INTO analyses VALUES (?, 1, ?)", (track_id, json.dumps(body)))
        db.commit()
    return tmp_path


def agent(catalog_dir: Path) -> PlaylistAgent:
    return PlaylistAgent(CatalogRepository(catalog_dir), RuleBasedRequestInterpreter())


def test_achievable_request_uses_real_unique_tracks(catalog_dir: Path) -> None:
    result = agent(catalog_dir).plan(
        "Make me a cycling playlist with 4 songs: two hills, one sprint, and one surprise."
    )

    assert result.status == "complete"
    assert result.understood_request.artist is None
    assert result.validation.satisfied
    assert result.validation.actual_ride_types == {"hill": 2, "sprint": 1, "surprise": 1}
    assert len(result.entries) == 4
    assert len({entry.track_id for entry in result.entries}) == 4
    assert {entry.track_id for entry in result.entries} <= {row[0] for row in TRACKS}
    assert all(entry.explanation for entry in result.entries)


def test_impossible_artist_request_reports_shortfall_without_fabrication(catalog_dir: Path) -> None:
    result = agent(catalog_dir).plan("Make me a Beyonce cycling playlist with 10 songs.")

    assert result.status == "impossible"
    assert result.entries == []
    assert not result.validation.satisfied
    assert result.validation.valid_track_ids
    assert any("only 0" in item for item in result.shortfalls)


def test_artist_filter_and_requested_roles(catalog_dir: Path) -> None:
    result = agent(catalog_dir).plan(
        "Make me a Rihanna cycling playlist with three songs: one hill, one sprint, and one surprise."
    )

    assert result.status == "complete"
    assert len(result.entries) == 3
    assert all("Rihanna" in entry.title for entry in result.entries)


def test_interpreter_understands_climb_synonym_and_articles() -> None:
    request = RuleBasedRequestInterpreter().interpret(
        "I need a high intensity ride with two climbs, a sprint, and a recovery."
    )

    assert request.intensity == "high"
    assert request.ride_types == {"hill": 2, "sprint": 1, "recovery": 1}


def test_duration_drives_count_and_is_validated(catalog_dir: Path) -> None:
    result = agent(catalog_dir).plan("Build a 12 minute moderate intensity playlist.")

    assert result.understood_request.duration_minutes == 12
    assert result.understood_request.intensity == "moderate"
    assert len(result.entries) == 3
    assert result.validation.requested_duration_minutes == 12
    assert result.validation.actual_duration_minutes == pytest.approx(12, abs=2)


def test_conversational_revision_replaces_named_role_with_harder_song(catalog_dir: Path) -> None:
    initial = agent(catalog_dir).plan("Make me a playlist with 3 songs: two hills and one sprint.")
    hill_index = next(
        index for index, entry in enumerate(initial.entries) if entry.purpose == "hill"
    )
    used = {entry.track_id for entry in initial.entries}
    easy = next(row for row in TRACKS if row[0] not in used and row[4] < 0.5)
    initial.entries[hill_index].track_id = easy[0]
    initial.entries[hill_index].title = easy[1]
    initial.entries[hill_index].energy = easy[4]
    old_hill = initial.entries[hill_index].model_copy(deep=True)

    revised = agent(catalog_dir).plan("Replace the first hill with something harder.", initial)

    new_hill = next(entry for entry in revised.entries if entry.purpose == "hill")
    assert new_hill.track_id != old_hill.track_id
    assert new_hill.energy > old_hill.energy
    assert revised.validation.valid_track_ids
    assert len({entry.track_id for entry in revised.entries}) == len(revised.entries)


def test_revision_reports_when_no_unused_harder_track_exists(catalog_dir: Path) -> None:
    initial = agent(catalog_dir).plan("Make me a playlist with 6 songs: five hills and one sprint.")
    hardest_index = max(
        (index for index, entry in enumerate(initial.entries) if entry.purpose == "hill"),
        key=lambda index: initial.entries[index].energy,
    )
    hills_before = [entry for entry in initial.entries if entry.purpose == "hill"]
    ordinal = hills_before.index(initial.entries[hardest_index]) + 1

    revised = agent(catalog_dir).plan(f"Replace the {ordinal} hill with something harder.", initial)

    assert revised.status == "partial"
    assert [entry.track_id for entry in revised.entries] == [
        entry.track_id for entry in initial.entries
    ]
    assert any("No unused analyzed track" in item for item in revised.shortfalls)


def test_api_returns_song_based_playlist_shape(catalog_dir: Path) -> None:
    app = create_app(
        Settings(data_dir=catalog_dir, web_dir=None),
        playlist_interpreter=RuleBasedRequestInterpreter(),
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/playlists/plan",
            json={"request": "Build a playlist with 2 songs: one hill and one sprint."},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "complete"
    assert set(payload["entries"][0]) >= {
        "position",
        "track_id",
        "title",
        "purpose",
        "bpm",
        "energy",
        "duration",
        "explanation",
    }
    assert payload["validation"]["valid_track_ids"] is True
