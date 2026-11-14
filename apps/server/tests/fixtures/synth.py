"""Deterministic synthetic songs for the analysis tests.

Each song has sections with their own chords, loudness and drums, so a section change is a real
change in harmony and energy. `labels()` gives the hand-set boundaries. The committed
`*.labels.json` files are written from these specs (see test_fixture_labels.py).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf
from numpy.typing import NDArray

SR = 22050

# Chord = (root midi note, quality)
Chord = tuple[int, str]
MAJ, MIN = "maj", "min"
A3, B3, C4, D4, E4, F3, G3 = 57, 59, 60, 62, 64, 53, 55

VERSE: list[Chord] = [(A3, MIN), (F3, MAJ), (C4, MAJ), (G3, MAJ)]
CHORUS: list[Chord] = [(D4, MAJ), (B3, MIN), (G3, MAJ), (A3, MAJ)]
BRIDGE: list[Chord] = [(E4, MIN), (C4, MAJ), (D4, MIN), (E4, MAJ)]
DROP: list[Chord] = [(F3, MIN), (F3, MIN), (53 + 8, MAJ), (53 + 3, MAJ)]
DRONE: list[Chord] = [(A3, MIN)]
INTRO: list[Chord] = [(D4, MIN)]


@dataclass(frozen=True)
class SectionSpec:
    name: str
    bars: int
    chords: list[Chord]
    gain: float
    harmonics: int = 3
    kick: bool = False
    hats: bool = False
    arp: bool = False


@dataclass(frozen=True)
class SongSpec:
    name: str
    bpm: float
    sections: list[SectionSpec]
    lead_silence: float = 0.0
    tail_silence: float = 0.0
    seed: int = 1
    notes: str = field(default="", compare=False)

    @property
    def bar_sec(self) -> float:
        return 4 * 60.0 / self.bpm


def _tone(freq: float, n: int, harmonics: int) -> np.ndarray:
    t = np.arange(n) / SR
    out = np.zeros(n)
    for h in range(1, harmonics + 1):
        out += np.sin(2 * np.pi * freq * h * t) / h
    return out


def _env(n: int) -> np.ndarray:
    e = np.ones(n)
    k = min(n // 2, int(0.01 * SR))
    e[:k] = np.linspace(0, 1, k)
    e[-k:] = np.linspace(1, 0, k)
    return e


def _hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def _render_section(spec: SectionSpec, bar_sec: float, rng: np.random.Generator) -> np.ndarray:
    bar_n = round(bar_sec * SR)
    beat_n = bar_n // 4
    out = np.zeros(bar_n * spec.bars)
    kick_t = np.arange(int(0.15 * SR)) / SR
    kick = np.sin(2 * np.pi * (60 + 120 * np.exp(-kick_t * 30)) * kick_t) * np.exp(-kick_t * 12)
    for b in range(spec.bars):
        root, quality = spec.chords[b % len(spec.chords)]
        third = 3 if quality == MIN else 4
        notes = [root, root + third, root + 7]
        seg = np.zeros(bar_n)
        for m in notes:
            seg += _tone(_hz(m), bar_n, spec.harmonics) * 0.25
        seg += _tone(_hz(root - 24), bar_n, 2) * 0.4
        if spec.arp:
            for k in range(8):
                note = notes[k % 3] + 12
                s0, s1 = k * (bar_n // 8), (k + 1) * (bar_n // 8)
                seg[s0:s1] += _tone(_hz(note), s1 - s0, 4) * 0.3 * _env(s1 - s0)
        seg *= _env(bar_n)
        if spec.kick:
            for beat in range(4):
                s0 = beat * beat_n
                seg[s0 : s0 + len(kick)] += kick * 0.8
        if spec.hats:
            for eighth in range(8):
                s0 = eighth * (bar_n // 8)
                hat = rng.standard_normal(int(0.04 * SR)) * np.exp(-np.arange(int(0.04 * SR)) / 400)
                seg[s0 : s0 + len(hat)] += hat * 0.15
        out[b * bar_n : (b + 1) * bar_n] = seg * spec.gain
    return out


def render(spec: SongSpec) -> NDArray[np.float32]:
    rng = np.random.default_rng(spec.seed)
    parts = [np.zeros(int(spec.lead_silence * SR))]
    parts += [_render_section(s, spec.bar_sec, rng) for s in spec.sections]
    parts.append(np.zeros(int(spec.tail_silence * SR)))
    y = np.concatenate(parts)
    out: NDArray[np.float32] = (y / np.abs(y).max() * 0.9).astype(np.float32)
    return out


def labels(spec: SongSpec) -> dict[str, Any]:
    t = spec.lead_silence
    boundaries: list[float] = []
    for s in spec.sections[:-1]:
        t += s.bars * spec.bar_sec
        boundaries.append(round(t, 3))
    total = spec.lead_silence + sum(s.bars for s in spec.sections) * spec.bar_sec
    return {
        "name": spec.name,
        "boundaries": boundaries,
        "cropStart": round(spec.lead_silence, 3),
        "cropEnd": round(total, 3),
        "sections": [s.name for s in spec.sections],
    }


SONGS: list[SongSpec] = [
    SongSpec(
        "pop_a",
        120,
        [
            SectionSpec("intro", 4, INTRO, 0.25, 2),
            SectionSpec("verse", 6, VERSE, 0.4, 3, kick=True),
            SectionSpec("chorus", 6, CHORUS, 0.85, 5, kick=True, hats=True, arp=True),
            SectionSpec("verse", 6, VERSE, 0.4, 3, kick=True),
            SectionSpec("chorus", 6, CHORUS, 0.85, 5, kick=True, hats=True, arp=True),
            SectionSpec("outro", 3, INTRO, 0.25, 2),
        ],
        seed=1,
    ),
    SongSpec(
        "edm_b",
        128,
        [
            SectionSpec("intro", 8, INTRO, 0.3, 2, kick=True),
            SectionSpec("build", 8, BRIDGE, 0.55, 4, kick=True, hats=True),
            SectionSpec("drop", 8, DROP, 0.95, 6, kick=True, hats=True, arp=True),
            SectionSpec("break", 8, VERSE, 0.3, 2),
            SectionSpec("drop", 8, DROP, 0.95, 6, kick=True, hats=True, arp=True),
        ],
        seed=2,
    ),
    SongSpec(
        "ballad_c",
        100,
        [
            SectionSpec("verse", 5, VERSE, 0.3, 2),
            SectionSpec("chorus", 5, CHORUS, 0.7, 4, kick=True),
            SectionSpec("verse", 5, VERSE, 0.3, 2),
            SectionSpec("chorus", 5, CHORUS, 0.7, 4, kick=True),
            SectionSpec("bridge", 5, BRIDGE, 0.5, 3),
            SectionSpec("chorus", 5, CHORUS, 0.9, 5, kick=True, hats=True),
        ],
        seed=3,
    ),
    SongSpec(
        "rock_d",
        140,
        [
            SectionSpec("intro", 6, INTRO, 0.3, 4, kick=True),
            SectionSpec("verse", 8, VERSE, 0.5, 4, kick=True, hats=True),
            SectionSpec("chorus", 8, CHORUS, 0.95, 6, kick=True, hats=True),
            SectionSpec("verse", 8, VERSE, 0.5, 4, kick=True, hats=True),
            SectionSpec("solo", 8, BRIDGE, 0.75, 6, kick=True, hats=True, arp=True),
            SectionSpec("chorus", 8, CHORUS, 0.95, 6, kick=True, hats=True),
        ],
        seed=4,
    ),
    SongSpec(
        "silence_e",
        110,
        [
            SectionSpec("verse", 6, VERSE, 0.4, 3, kick=True),
            SectionSpec("chorus", 6, CHORUS, 0.9, 5, kick=True, hats=True),
            SectionSpec("bridge", 6, BRIDGE, 0.6, 4, kick=True),
        ],
        lead_silence=3.0,
        tail_silence=4.0,
        seed=5,
        notes="Leading and trailing digital silence must be cropped.",
    ),
    SongSpec(
        "steps_f",
        100,
        [
            SectionSpec("low", 9, DRONE, 0.15, 3),
            SectionSpec("mid", 9, DRONE, 0.45, 3),
            SectionSpec("high", 9, DRONE, 0.95, 3),
        ],
        seed=6,
        notes="Same harmony throughout; only loudness changes.",
    ),
]


def write_fixtures(directory: Path) -> dict[str, Path]:
    """Writes each song as <name>.wav in `directory` and returns name -> path."""
    directory.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    for spec in SONGS:
        path = directory / f"{spec.name}.wav"
        if not path.exists():
            sf.write(path, render(spec), SR, subtype="PCM_16")
        paths[spec.name] = path
    return paths
