"""Section detection: novelty, peak picking, clustering, intro/outro. All times are original-file seconds."""

from __future__ import annotations

import itertools
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from .models import SectionInfo

KERNEL_SEC = 4.0
NOVELTY_FEATURE_WEIGHT = 0.75
NOVELTY_ENERGY_WEIGHT = 0.25
PEAK_STD_FACTOR = 0.6
MIN_PEAK_SPACING_SEC = 8.0
SIMILARITY_THRESHOLD = 0.88
ENERGY_CLUSTER_WEIGHT = 1.8
MIN_SEGMENT_SEC = 6.0
FALLBACK_MIN_SEGMENT_SEC = 12.0
EDGE_MIN_SEC = 25.0
EDGE_FRACTION = 0.15
MAX_SECTIONS = 60
TIER_THRESHOLDS = (0.28, 0.44, 0.62)
EDGE_MARGIN_SEC = 0.05


@dataclass
class Seg:
    start: float
    end: float
    root: int = 0
    is_group: bool = False


def _cosine(a: NDArray[np.float64], b: NDArray[np.float64]) -> float:
    na = float(np.linalg.norm(a)) or 1.0
    nb = float(np.linalg.norm(b)) or 1.0
    return float(np.dot(a, b) / (na * nb))


def energy_per_frame(
    times: NDArray[np.float64], e: NDArray[np.float64], hop: float, frames: int
) -> NDArray[np.float64]:
    """Mean energy in each feature frame [i*hop, (i+1)*hop). Empty frames use the nearest point."""
    out = np.zeros(frames)
    for i in range(frames):
        lo, hi = i * hop, (i + 1) * hop
        mask = (times >= lo) & (times < hi)
        if mask.any():
            out[i] = e[mask].mean()
        elif len(e):
            out[i] = e[int(np.argmin(np.abs(times - (lo + hi) / 2)))]
    return out


def novelty_curve(
    features: NDArray[np.float64], frame_energy: NDArray[np.float64], hop: float
) -> NDArray[np.float64]:
    """How different the 4 s before each point is from the 4 s after it, blended with energy change."""
    n = len(features)
    k = max(3, round(KERNEL_SEC / hop))
    nov = np.zeros(n)
    for i in range(k, n - k):
        before = features[i - k : i].mean(axis=0)
        after = features[i : i + k].mean(axis=0)
        feat_nov = 1.0 - _cosine(before, after)
        e_change = abs(float(frame_energy[i : i + k].mean() - frame_energy[i - k : i].mean()))
        nov[i] = NOVELTY_FEATURE_WEIGHT * feat_nov + NOVELTY_ENERGY_WEIGHT * e_change
    return nov


def pick_peaks(novelty: NDArray[np.float64], hop: float) -> list[float]:
    """Local maxima above mean + 0.6*std of the positive values, at least 8 s apart. Returns seconds."""
    positive = novelty[novelty > 0]
    if len(positive) == 0:
        return []
    threshold = float(positive.mean() + PEAK_STD_FACTOR * positive.std())
    min_gap = max(2, round(MIN_PEAK_SPACING_SEC / hop))
    candidates = [
        (i, float(novelty[i]))
        for i in range(1, len(novelty) - 1)
        if novelty[i] > novelty[i - 1] and novelty[i] >= novelty[i + 1] and novelty[i] > threshold
    ]
    # Strongest first; the index breaks ties so the result is deterministic.
    candidates.sort(key=lambda c: (-c[1], c[0]))
    chosen: list[int] = []
    for i, _ in candidates:
        if all(abs(i - j) >= min_gap for j in chosen):
            chosen.append(i)
    return [i * hop for i in sorted(chosen)]


def _find(parent: list[int], x: int) -> int:
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def cluster_segments(vectors: list[NDArray[np.float64]]) -> list[tuple[int, bool]]:
    """Whole-segment clustering. Never chains raw frames. Returns (root, is_group) per segment."""
    n = len(vectors)
    parent = list(range(n))
    for i in range(n):
        for j in range(i + 1, n):
            if _cosine(vectors[i], vectors[j]) >= SIMILARITY_THRESHOLD:
                ri, rj = _find(parent, i), _find(parent, j)
                if ri != rj:
                    parent[ri] = rj
    roots = [_find(parent, i) for i in range(n)]
    return [(r, roots.count(r) >= 2) for r in roots]


def merge_short(segs: list[Seg], min_len: float) -> list[Seg]:
    out = [Seg(s.start, s.end, s.root, s.is_group) for s in segs]
    changed = True
    while changed and len(out) > 1:
        changed = False
        for i, s in enumerate(out):
            if s.end - s.start >= min_len:
                continue
            if i == 0:
                out[1].start = s.start
            elif i == len(out) - 1 or out[i - 1].root == s.root:
                out[i - 1].end = s.end
            elif out[i + 1].root == s.root:
                out[i + 1].start = s.start
            else:
                out[i - 1].end = s.end
            del out[i]
            changed = True
            break
    return out


def label_sections(segs: list[Seg], crop_start: float, crop_end: float) -> list[SectionInfo]:
    """Intro and outro are short unrepeated edge segments. Others are numbered by position only."""
    duration = crop_end - crop_start
    split: dict[int, str] = {}
    for i in range(len(segs) - 1):
        a, b = segs[i], segs[i + 1]
        shorter = (a.end - a.start) < (b.end - b.start) * 0.85
        if a.is_group and b.is_group and a.root == b.root and shorter:
            split[i] = f"{a.root}-split"

    limit = max(EDGE_MIN_SEC, duration * EDGE_FRACTION)
    kinds: list[str] = []
    keys: list[str | None] = []
    for i, s in enumerate(segs):
        length = s.end - s.start
        if i == 0 and length < limit and not s.is_group:
            kinds.append("intro")
            keys.append(None)
        elif i == len(segs) - 1 and length < limit and not s.is_group:
            kinds.append("outro")
            keys.append(None)
        else:
            kinds.append("section")
            keys.append(split.get(i, str(s.root)))

    first_with_key: dict[str, int] = {}
    info: list[SectionInfo] = []
    for i, kind in enumerate(kinds):
        key = keys[i]
        similar: int | None = None
        if key is not None:
            if key in first_with_key:
                similar = first_with_key[key]
            else:
                first_with_key[key] = i
        info.append(SectionInfo(kind=kind, similar_to=similar))
    return info


def detect_structure(
    features: NDArray[np.float64],
    frame_energy: NDArray[np.float64],
    hop: float,
    crop_start: float,
    crop_end: float,
    snap: Callable[[list[float]], list[float]] | None = None,
) -> tuple[list[float], list[SectionInfo]] | None:
    """Returns (boundaries, structure) or None when fewer than 2 usable sections are found."""
    if len(features) < 8:
        return None
    novelty = novelty_curve(features, frame_energy, hop)
    peaks = [
        t
        for t in pick_peaks(novelty, hop)
        if crop_start + EDGE_MARGIN_SEC < t < crop_end - EDGE_MARGIN_SEC
    ]
    if snap is not None:
        peaks = [
            t for t in snap(peaks) if crop_start + EDGE_MARGIN_SEC < t < crop_end - EDGE_MARGIN_SEC
        ]

    bounds = [crop_start, *peaks, crop_end]
    segs = [Seg(a, b) for a, b in itertools.pairwise(bounds) if b - a >= 0.3]
    if len(segs) < 2:
        return None

    vectors: list[NDArray[np.float64]] = []
    for s in segs:
        i0 = max(0, round(s.start / hop))
        i1 = min(len(features), round(s.end / hop))
        feat = features[i0:i1].mean(axis=0) if i1 > i0 else np.zeros(features.shape[1])
        energy = float(frame_energy[i0:i1].mean()) if i1 > i0 else 0.0
        vectors.append(np.concatenate([feat, [energy * ENERGY_CLUSTER_WEIGHT]]))
    for s, (root, is_group) in zip(segs, cluster_segments(vectors)):
        s.root, s.is_group = root, is_group

    segs = merge_short(segs, MIN_SEGMENT_SEC)
    if len(segs) < 2 or len(segs) > MAX_SECTIONS:
        return None
    segs[0].start = crop_start
    segs[-1].end = crop_end
    return [s.start for s in segs[1:]], label_sections(segs, crop_start, crop_end)


def tier_index(e: float) -> int:
    return sum(e > t for t in TIER_THRESHOLDS)


def fallback_boundaries(
    times: NDArray[np.float64], e: NDArray[np.float64], crop_start: float, crop_end: float
) -> list[float]:
    """Segments by energy tier, merging any segment under 12 s into a neighbor."""
    mask = (times >= crop_start) & (times <= crop_end)
    t, v = times[mask], e[mask]
    if len(t) == 0:
        return []
    tiers = [tier_index(x) for x in v]
    # Each run is [start, end, tier].
    segs: list[list[float]] = []
    cur_start, cur = crop_start, tiers[0]
    for i in range(1, len(tiers)):
        if tiers[i] != cur:
            segs.append([cur_start, float(t[i]), cur])
            cur, cur_start = tiers[i], float(t[i])
    segs.append([cur_start, crop_end, cur])
    changed = True
    while changed and len(segs) > 1:
        changed = False
        for i, s in enumerate(segs):
            if s[1] - s[0] >= FALLBACK_MIN_SEGMENT_SEC:
                continue
            if i == 0:
                segs[1][0] = s[0]
            else:
                segs[i - 1][1] = s[1]
                # The neighbors on both sides may now be the same tier: join them.
                if i + 1 < len(segs) and segs[i - 1][2] == segs[i + 1][2]:
                    segs[i - 1][1] = segs[i + 1][1]
                    del segs[i + 1]
            del segs[i]
            changed = True
            break
    return [s[0] for s in segs[1:]]
