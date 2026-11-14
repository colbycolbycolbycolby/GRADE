import json
import wave
from pathlib import Path
from typing import Any

import jsonschema
import numpy as np
import pytest

from analysis import ANALYZER_VERSION, Analysis, LibrosaAnalyzer
from analysis.beats import snap_boundaries
from analysis.energy import detect_trim_range, energy_curve
from analysis.structure import (
    Seg,
    cluster_segments,
    detect_structure,
    fallback_boundaries,
    merge_short,
    pick_peaks,
)
from tests.fixtures.synth import SONGS, labels

Results = dict[str, Analysis]
ROOT = Path(__file__).resolve().parents[4]
FIXED_NOW = lambda: "2026-01-01T00:00:00Z"
TOLERANCE_SEC = 2.0
METRICS = Path(__file__).parent / "metrics.json"


def _schema() -> dict[str, Any]:
    out: dict[str, Any] = json.loads((ROOT / "packages/schema/json/schema.json").read_text())
    return out


def _hits(detected: list[float], expected: list[float]) -> int:
    return sum(any(abs(d - e) <= TOLERANCE_SEC for d in detected) for e in expected)


@pytest.fixture(scope="module")
def results(fixture_wavs: dict[str, Path]) -> Results:
    analyzer = LibrosaAnalyzer(now=FIXED_NOW)
    return {name: analyzer.analyze(str(p)) for name, p in fixture_wavs.items()}


def test_output_matches_json_schema(results: Results) -> None:
    schema = _schema()
    for a in results.values():
        doc = {**schema, "$ref": "#/definitions/Analysis"}
        payload = {**a.to_dict(), "trackId": "yt:dQw4w9WgXcQ"}
        jsonschema.validate(payload, doc)


def test_structure_is_aligned_with_boundaries(results: Results) -> None:
    for a in results.values():
        assert len(a.structure) == len(a.boundaries) + 1
        assert all(a.crop_start < b < a.crop_end for b in a.boundaries)
        assert a.boundaries == sorted(a.boundaries)
        for i, s in enumerate(a.structure):
            assert s.similar_to is None or s.similar_to < i


def test_deterministic(fixture_wavs: dict[str, Path]) -> None:
    analyzer = LibrosaAnalyzer(now=FIXED_NOW)
    path = str(fixture_wavs["pop_a"])
    assert analyzer.analyze(path).to_dict() == analyzer.analyze(path).to_dict()


def test_progress_is_monotonic_and_ends_at_one(fixture_wavs: dict[str, Path]) -> None:
    seen: list[float] = []
    LibrosaAnalyzer(now=FIXED_NOW).analyze(str(fixture_wavs["ballad_c"]), seen.append)
    assert seen == sorted(seen)
    assert seen[0] == 0.0 and seen[-1] == 1.0


def test_energy_is_normalized_at_about_10hz(results: Results) -> None:
    a = results["pop_a"]
    es = [e for _, e in a.energy]
    assert min(es) == pytest.approx(0.0, abs=1e-3) and max(es) == pytest.approx(1.0, abs=1e-3)
    rate = (len(a.energy) - 1) / (a.energy[-1][0] - a.energy[0][0])
    assert rate == pytest.approx(10, rel=0.02)


def test_beats_and_tempo(results: Results) -> None:
    a = results["pop_a"]
    assert a.bpm is not None and abs(a.bpm - 120) < 3 or abs((a.bpm or 0) - 60) < 2
    assert a.beats and a.downbeats
    assert set(a.downbeats) <= set(a.beats)


def test_silence_is_cropped(results: Results) -> None:
    a = results["silence_e"]
    expected = labels(next(s for s in SONGS if s.name == "silence_e"))
    assert a.crop_start == pytest.approx(expected["cropStart"], abs=0.5)
    # The trailing moving average (1.2 s, as in the legacy app) keeps energy up a little past the end.
    assert a.crop_end == pytest.approx(expected["cropEnd"], abs=1.5)
    assert results["pop_a"].crop_start == 0.0


def test_repeats_are_marked_similar(results: Results) -> None:
    a = results["pop_a"]
    # verse/chorus repeat: at least one later section points back at an earlier one.
    assert any(s.similar_to is not None for s in a.structure)


def test_boundary_metric_does_not_regress(results: Results) -> None:
    hit = total = 0
    per_song: dict[str, float] = {}
    for spec in SONGS:
        exp = labels(spec)["boundaries"]
        h = _hits(results[spec.name].boundaries, exp)
        per_song[spec.name] = round(h / len(exp), 3)
        hit, total = hit + h, total + len(exp)
    recall = round(hit / total, 3)
    print(f"boundary recall v{ANALYZER_VERSION}: {recall} {per_song}")
    recorded = json.loads(METRICS.read_text()) if METRICS.exists() else {}
    key = str(ANALYZER_VERSION)
    if key not in recorded:
        recorded[key] = {"recall": recall, "per_song": per_song}
        METRICS.write_text(json.dumps(recorded, indent=2) + "\n")
    assert recall >= recorded[key]["recall"], (
        f"Boundary recall fell from {recorded[key]['recall']} to {recall}. "
        "Explain it in docs/decisions.md and update metrics.json, or fix the regression."
    )


def test_boundary_recall_floor(results: Results) -> None:
    """A hard floor so a bad first recording cannot pass silently."""
    hit = total = 0
    for spec in SONGS:
        exp = labels(spec)["boundaries"]
        hit += _hits(results[spec.name].boundaries, exp)
        total += len(exp)
    assert hit / total >= 0.6


# ---- unit tests for the pure pieces ----


def test_fallback_path_splits_by_energy() -> None:
    times = np.arange(0, 90, 0.1)
    e = np.where(times < 30, 0.1, np.where(times < 60, 0.5, 0.9))
    assert fallback_boundaries(times, e, 0.0, 90.0) == pytest.approx([30.0, 60.0], abs=0.2)


def test_fallback_merges_segments_under_12s_and_joins_equal_tiers() -> None:
    times = np.arange(0, 60, 0.1)
    e = np.where((times > 20) & (times < 25), 0.9, 0.1)
    assert fallback_boundaries(times, e, 0.0, 60.0) == []


def test_structure_returns_none_when_too_little_audio() -> None:
    feats = np.ones((5, 15))
    assert detect_structure(feats, np.ones(5), 0.5, 0.0, 2.5) is None


def test_structure_returns_none_when_nothing_changes() -> None:
    feats = np.tile(np.arange(15, dtype=float) + 1, (200, 1))
    assert detect_structure(feats, np.full(200, 0.5), 0.5, 0.0, 100.0) is None


def test_analyzer_uses_fallback_when_structure_fails(
    fixture_wavs: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    import analysis.analyzer as mod

    monkeypatch.setattr(mod, "detect_structure", lambda *a, **k: None)
    a = LibrosaAnalyzer(now=FIXED_NOW).analyze(str(fixture_wavs["steps_f"]))
    assert all(s.kind == "section" and s.similar_to is None for s in a.structure)
    assert len(a.structure) == len(a.boundaries) + 1
    assert _hits(a.boundaries, [22.8, 45.6]) >= 1


def test_pick_peaks_min_spacing() -> None:
    nov = np.full(200, 0.01)
    nov[[50, 55, 120]] = [0.9, 1.0, 0.95]
    assert pick_peaks(nov, 0.5) == [27.5, 60.0]


def test_cluster_and_merge() -> None:
    v = [np.array([1.0, 0.0]), np.array([0.0, 1.0]), np.array([1.0, 0.01])]
    assert [g for _, g in cluster_segments(v)] == [True, False, True]
    segs = [Seg(0, 20, 1), Seg(20, 23, 2), Seg(23, 50, 1)]
    merged = merge_short(segs, 6)
    assert [(s.start, s.end) for s in merged] == [(0, 20), (20, 50)] or len(merged) == 2


def test_trim_keeps_at_least_ten_seconds() -> None:
    t = np.arange(0, 8, 0.1)
    e = np.where(t < 3, 0.0, 1.0)
    assert detect_trim_range(t, e, 8.0) == (0.0, 8.0)


def test_snap_prefers_downbeat_then_beat() -> None:
    beats = [float(i) * 0.5 for i in range(40)]
    downbeats = beats[::4]
    assert snap_boundaries([4.3], beats, downbeats, 120.0) == [4.0]
    assert snap_boundaries([5.1], beats, [0.0], 120.0) == [5.0]
    assert snap_boundaries([5.1], None, None, None) == [5.1]


def test_energy_curve_silent_input() -> None:
    t, e, level = energy_curve(np.zeros(22050 * 2, dtype=np.float32), 22050)
    assert len(t) > 0 and float(e.max()) == 0.0 and float(level.max()) == 0.0


def test_wav_fixture_is_valid(fixture_wavs: dict[str, Path]) -> None:
    with wave.open(str(fixture_wavs["pop_a"])) as w:
        assert w.getframerate() == 22050 and w.getnchannels() == 1
