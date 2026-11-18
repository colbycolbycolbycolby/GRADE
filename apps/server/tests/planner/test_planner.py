from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from api import Settings, create_app
from planner import (
    CatalogRepository,
    OpenAIRequestInterpreter,
    PlaylistAgent,
    RuleBasedRequestInterpreter,
)
from planner.workout_interpreter import OpenAIWorkoutInterpreter, RuleBasedWorkoutInterpreter

TRACKS = [
    ("yt:AAAAAAAAAAA", "Rihanna - Easy Start", 210.0, 92.0, 0.25, 5),
    ("yt:BBBBBBBBBBB", "Rihanna - Rolling Hill", 240.0, 120.0, 0.55, 8),
    ("yt:CCCCCCCCCCC", "Rihanna - Fast Finish", 225.0, 132.0, 0.75, 11),
    ("yt:DDDDDDDDDDD", "Other Artist - Heavy Climb", 260.0, 118.0, 0.9, 7),
    ("yt:EEEEEEEEEEE", "Other Artist - Recovery", 200.0, 84.0, 0.15, 4),
    ("yt:FFFFFFFFFFF", "Other Artist - Wild Card", 230.0, 128.0, 0.65, 15),
]


def add_tracks(catalog_dir: Path, rows: list[tuple[str, str]]) -> None:
    with sqlite3.connect(catalog_dir / "grade.sqlite3") as db:
        for index, (track_id, title) in enumerate(rows):
            duration = 200 + index
            body = {
                "trackId": track_id,
                "bpm": 90 + index,
                "energy": [{"t": 0, "e": 0.3}, {"t": duration, "e": 0.7}],
                "boundaries": [100],
                "structure": [{"kind": "section"}, {"kind": "section"}],
            }
            db.execute(
                "INSERT INTO tracks VALUES (?, 'youtube', ?, ?)",
                (track_id, title, duration),
            )
            db.execute(
                "INSERT INTO analyses VALUES (?, 1, ?)",
                (track_id, json.dumps(body)),
            )


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


def test_product_example_parses_hyphenated_count_artist_and_class() -> None:
    request = RuleBasedRequestInterpreter().interpret(
        "Make me a 10-song Rihanna class with five hills, four sprints, and one surprise."
    )

    assert request.song_count == 10
    assert request.artist == "Rihanna"
    assert request.ride_types == {"hill": 5, "sprint": 4, "surprise": 1}


def test_vague_request_does_not_return_the_entire_catalog(catalog_dir: Path) -> None:
    add_tracks(
        catalog_dir,
        [(f"yt:{index:011d}", f"Catalog Artist - Song {index}") for index in range(41)],
    )

    result = agent(catalog_dir).plan("Make me a playlist.")

    assert len(result.entries) == 10
    assert result.validation.actual_song_count == 10


def test_repeated_request_uses_reproducible_novelty_from_previous(catalog_dir: Path) -> None:
    add_tracks(
        catalog_dir,
        [(f"yt:{index:011d}", f"Catalog Artist - Song {index}") for index in range(20)],
    )
    planner = agent(catalog_dir)
    first = planner.plan("Give me a 10-song playlist.")
    second = planner.plan("Give me a 10-song playlist.", first)
    repeated_second = planner.plan("Give me a 10-song playlist.", first)

    assert {entry.track_id for entry in first.entries}.isdisjoint(
        entry.track_id for entry in second.entries
    )
    assert [entry.track_id for entry in repeated_second.entries] == [
        entry.track_id for entry in second.entries
    ]


def test_five_song_followup_is_not_prefix_of_ten_song_result(catalog_dir: Path) -> None:
    add_tracks(
        catalog_dir,
        [(f"yt:{index:011d}", f"Catalog Artist - Song {index}") for index in range(10)],
    )
    planner = agent(catalog_dir)
    ten = planner.plan("Give me a 10-song playlist.")
    five = planner.plan("Give me a 5-song playlist.", ten)

    assert len(five.entries) == 5
    assert [entry.track_id for entry in five.entries] != [
        entry.track_id for entry in ten.entries[:5]
    ]


def test_make_this_larger_preserves_existing_tracks_and_adds_unique_tracks(
    catalog_dir: Path,
) -> None:
    add_tracks(
        catalog_dir,
        [(f"yt:{index:011d}", f"Catalog Artist - Song {index}") for index in range(10)],
    )
    planner = agent(catalog_dir)
    ten = planner.plan("Give me a 10-song playlist.")
    fifteen = planner.plan("Make this a 15-song playlist.", ten)

    assert len(fifteen.entries) == 15
    assert [entry.track_id for entry in fifteen.entries[:10]] == [
        entry.track_id for entry in ten.entries
    ]
    assert len({entry.track_id for entry in fifteen.entries}) == 15


def test_named_song_replacement_uses_exact_catalog_track(catalog_dir: Path) -> None:
    add_tracks(
        catalog_dir,
        [
            ("yt:HHHHHHHHHHH", "Weird Al Yankovic - Hardware Store"),
            ("yt:IIIIIIIIIII", "Rihanna - Breakin' Dishes"),
        ],
    )
    planner = agent(catalog_dir)
    initial = planner.plan("Give me an 8-song playlist.")
    assert any(entry.title.endswith("Hardware Store") for entry in initial.entries)
    initial.entries = [
        entry for entry in initial.entries if not entry.title.endswith("Breakin' Dishes")
    ]

    revised = planner.plan("Replace Hardware Store with Breakin' Dishes", initial)

    assert any(entry.title.endswith("Breakin' Dishes") for entry in revised.entries)
    assert not any(entry.title.endswith("Hardware Store") for entry in revised.entries)
    assert revised.validation.valid_track_ids


def test_openai_mode_preserves_precise_local_named_revision() -> None:
    interpreter = OpenAIRequestInterpreter("not-a-real-key")
    model_request = {
        "artist": None,
        "song_count": 8,
        "duration_minutes": None,
        "intensity": None,
        "ride_types": {},
        "revision": {
            "action": "replace",
            "position": 1,
            "ride_type": None,
            "harder": False,
            "target_title": None,
            "replacement_title": None,
        },
    }
    interpreter._client = SimpleNamespace(  # type: ignore[assignment]
        responses=SimpleNamespace(
            create=lambda **_: SimpleNamespace(output_text=json.dumps(model_request))
        )
    )

    request = interpreter.interpret("Replace Hardware Store with Breakin' Dishes")

    assert request.revision is not None
    assert request.revision.target_title == "Hardware Store"
    assert request.revision.replacement_title == "Breakin' Dishes"


@pytest.mark.parametrize(
    ("prompt", "artist"),
    [
        ("Give me a 3-song Rihanna playlist.", "Rihanna"),
        ("Give me 3 songs by Rihanna.", "Rihanna"),
        ("Build a playlist from Rihanna with 3 songs.", "Rihanna"),
    ],
)
def test_artist_request_phrasings_are_consistent(prompt: str, artist: str) -> None:
    request = RuleBasedRequestInterpreter().interpret(prompt)

    assert request.song_count == 3
    assert request.artist == artist


def test_planner_sees_song_inserted_after_agent_creation(catalog_dir: Path) -> None:
    planner = agent(catalog_dir)
    assert planner.plan("Make me a New Artist class.").entries == []
    body = {
        "trackId": "yt:GGGGGGGGGGG",
        "bpm": 110,
        "energy": [{"t": 0, "e": 0.5}, {"t": 200, "e": 0.7}],
        "boundaries": [100],
        "structure": [{"kind": "section"}, {"kind": "section"}],
    }
    with sqlite3.connect(catalog_dir / "grade.sqlite3") as db:
        db.execute(
            "INSERT INTO tracks VALUES (?, 'youtube', ?, ?)",
            ("yt:GGGGGGGGGGG", "New Artist - Fresh Song", 200),
        )
        db.execute(
            "INSERT INTO analyses VALUES (?, 1, ?)",
            ("yt:GGGGGGGGGGG", json.dumps(body)),
        )

    result = planner.plan("Make me a New Artist class.")
    assert [entry.track_id for entry in result.entries] == ["yt:GGGGGGGGGGG"]


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


def test_explicit_song_count_wins_over_conflicting_role_counts(catalog_dir: Path) -> None:
    result = agent(catalog_dir).plan("Give me 2 songs with three hills and one sprint.")

    assert len(result.entries) == 2
    assert result.validation.requested_song_count == 2
    assert any("Requested 3 hill" in item for item in result.shortfalls)


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


def test_openai_workout_interpreter_returns_validated_constraints() -> None:
    interpreter = OpenAIWorkoutInterpreter("not-a-real-key", "test-model")
    interpreter._client = SimpleNamespace(  # type: ignore[assignment]
        responses=SimpleNamespace(
            create=lambda **_: SimpleNamespace(
                output_text=json.dumps(
                    {
                        "durationMinutes": 30,
                        "sequence": ["warmup", "climb", "sprint", "cooldown"],
                        "intensity": "hard",
                        "resistanceZones": [4],
                        "programCount": 4,
                        "artistPreferences": ["Rihanna"],
                        "artistExclusions": [],
                    }
                )
            )
        )
    )

    result = interpreter.interpret("Hard 30 minute Z4 class")

    assert result.mode == "openai"
    assert result.model == "test-model"
    assert result.sequence == ["warmup", "climb", "sprint", "cooldown"]


def test_openai_workout_interpreter_falls_back_on_invalid_output() -> None:
    interpreter = OpenAIWorkoutInterpreter("not-a-real-key")
    interpreter._client = SimpleNamespace(  # type: ignore[assignment]
        responses=SimpleNamespace(create=lambda **_: SimpleNamespace(output_text="not json"))
    )

    result = interpreter.interpret("Hard 20-minute class with two climbs and Z4")

    assert result.mode == "deterministic"
    assert result.model is None
    assert result.durationMinutes == 20
    assert result.sequence == ["climb", "climb"]
    assert result.resistanceZones == [4]


def test_workout_interpretation_api_reports_fallback(catalog_dir: Path) -> None:
    app = create_app(
        Settings(data_dir=catalog_dir, web_dir=None),
        workout_interpreter=RuleBasedWorkoutInterpreter(),
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/workouts/interpret",
            json={"request": "20-minute endurance class"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "mode": "deterministic",
        "model": None,
        "durationMinutes": 20.0,
        "sequence": ["endurance"],
        "intensity": None,
        "resistanceZones": [],
        "programCount": None,
        "artistPreferences": [],
        "artistExclusions": [],
    }
