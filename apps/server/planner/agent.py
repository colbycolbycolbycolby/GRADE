from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from typing import Literal

from .catalog import CatalogRepository
from .interpreter import RequestInterpreter
from .models import (
    CatalogSong,
    ConstraintValidation,
    PlaylistEntry,
    PlaylistProposal,
    PlaylistRequest,
    RideType,
)

DEFAULT_ROLE_ORDER: tuple[RideType, ...] = ("warmup", "hill", "sprint", "recovery", "surprise")


class PlaylistAgent:
    """Small tool-using planner: interpret, search, score, arrange, then validate."""

    def __init__(self, catalog: CatalogRepository, interpreter: RequestInterpreter) -> None:
        self._catalog = catalog
        self._interpreter = interpreter

    def plan(self, text: str, previous: PlaylistProposal | None = None) -> PlaylistProposal:
        request = self._interpreter.interpret(text, previous)
        if request.revision is not None and previous is not None:
            return self._revise(request, previous)
        return self._create(request)

    def _create(self, request: PlaylistRequest) -> PlaylistProposal:
        candidates = self._catalog.search(request.artist)
        roles = self._requested_roles(request)
        duration_count: int | None = None
        if request.duration_minutes is not None and candidates:
            average_duration = sum(song.duration for song in candidates) / len(candidates)
            duration_count = max(
                1,
                min(len(candidates), round(request.duration_minutes * 60 / average_duration)),
            )
        target_count = request.song_count or len(roles) or duration_count or len(candidates)
        if not roles:
            roles = self._balanced_roles(target_count)
        elif len(roles) < target_count:
            roles.extend(self._balanced_roles(target_count - len(roles), offset=len(roles)))
        elif len(roles) > target_count:
            target_count = len(roles)

        entries: list[PlaylistEntry] = []
        available = list(candidates)
        for role in self._workout_order(roles):
            if not available:
                break
            song = max(
                available, key=lambda item: (self._score(item, role, request), item.track_id)
            )
            available.remove(song)
            entries.append(self._entry(song, role, len(entries) + 1))
        return self._proposal(request, entries, target_count)

    def _revise(self, request: PlaylistRequest, previous: PlaylistProposal) -> PlaylistProposal:
        revision = request.revision
        assert revision is not None
        entries = [entry.model_copy(deep=True) for entry in previous.entries]
        matching = [
            (index, entry)
            for index, entry in enumerate(entries)
            if revision.ride_type is None or entry.purpose == revision.ride_type
        ]
        shortfalls: list[str] = []
        if revision.position > len(matching):
            shortfalls.append(
                f"There is no {self._ordinal(revision.position)} "
                f"{revision.ride_type or 'playlist'} entry to replace."
            )
            return self._proposal(request, entries, len(entries), extra_shortfalls=shortfalls)

        index, old = matching[revision.position - 1]
        used = {entry.track_id for entry in entries}
        candidates = [
            song
            for song in self._catalog.search(request.artist)
            if song.track_id not in used
            and (not revision.harder or self._hardness(song) > self._entry_hardness(old))
        ]
        if not candidates:
            shortfalls.append(
                f"No unused analyzed track satisfies the replacement for {old.title!r}"
                + (" with a harder option." if revision.harder else ".")
            )
            return self._proposal(request, entries, len(entries), extra_shortfalls=shortfalls)
        replacement = max(
            candidates,
            key=lambda item: (self._score(item, old.purpose, request), self._hardness(item)),
        )
        entries[index] = self._entry(replacement, old.purpose, old.position)
        entries[index].explanation = f"Replaces {old.title}; " + entries[index].explanation
        return self._proposal(request, entries, len(entries))

    @staticmethod
    def _requested_roles(request: PlaylistRequest) -> list[RideType]:
        return [role for role in DEFAULT_ROLE_ORDER for _ in range(request.ride_types.get(role, 0))]

    @staticmethod
    def _balanced_roles(count: int, offset: int = 0) -> list[RideType]:
        cycle: tuple[RideType, ...] = ("warmup", "hill", "sprint", "recovery", "surprise")
        return [cycle[(offset + index) % len(cycle)] for index in range(count)]

    @staticmethod
    def _workout_order(roles: Iterable[RideType]) -> list[RideType]:
        pending = Counter(roles)
        ordered: list[RideType] = []
        if pending["warmup"]:
            ordered.append("warmup")
            pending["warmup"] -= 1
        intense_index = 0
        intense: tuple[RideType, ...] = ("hill", "sprint", "surprise")
        while sum(pending.values()):
            added = False
            for _ in intense:
                role = intense[intense_index % len(intense)]
                intense_index += 1
                if pending[role]:
                    ordered.append(role)
                    pending[role] -= 1
                    added = True
                    break
            if pending["recovery"] and (added or not any(pending[r] for r in intense)):
                ordered.append("recovery")
                pending["recovery"] -= 1
            elif not added:
                for role in DEFAULT_ROLE_ORDER:
                    if pending[role]:
                        ordered.append(role)
                        pending[role] -= 1
                        break
        return ordered

    @staticmethod
    def _score(song: CatalogSong, role: RideType, request: PlaylistRequest) -> float:
        bpm = song.bpm or 100.0
        cadence = bpm if bpm <= 125 else bpm / 2
        score = {
            "warmup": (1 - song.mean_energy) * 2 - abs(cadence - 85) / 50,
            "recovery": (1 - song.mean_energy) * 2 - abs(cadence - 80) / 50,
            "hill": song.mean_energy * 1.5 - abs(cadence - 70) / 45 + song.section_count / 100,
            "sprint": song.peak_energy * 1.5 - abs(bpm - 130) / 45,
            "surprise": song.energy_variation * 4 + song.boundary_count / 20,
        }[role]
        if request.intensity == "high":
            score += song.mean_energy + song.peak_energy
        elif request.intensity == "low":
            score += 2 - song.mean_energy - song.peak_energy
        return score

    @staticmethod
    def _entry(song: CatalogSong, role: RideType, position: int) -> PlaylistEntry:
        bpm = f"{song.bpm:.0f} BPM" if song.bpm is not None else "tempo unavailable"
        details = {
            "warmup": f"Its {bpm} and {song.mean_energy:.2f} average energy build gradually.",
            "recovery": f"Its {song.mean_energy:.2f} average energy supports controlled recovery.",
            "hill": f"Its sustained {song.mean_energy:.2f} energy and {bpm} suit loaded resistance.",
            "sprint": f"Its {song.peak_energy:.2f} peak energy and {bpm} support fast efforts.",
            "surprise": f"Its {song.boundary_count} boundaries create useful musical changes.",
        }[role]
        return PlaylistEntry(
            position=position,
            track_id=song.track_id,
            title=song.title,
            purpose=role,
            bpm=song.bpm,
            energy=round(song.mean_energy, 3),
            duration=song.duration,
            explanation=details,
        )

    def _proposal(
        self,
        request: PlaylistRequest,
        entries: list[PlaylistEntry],
        target_count: int,
        extra_shortfalls: list[str] | None = None,
    ) -> PlaylistProposal:
        shortfalls = list(extra_shortfalls or [])
        if request.song_count is not None and len(entries) != request.song_count:
            shortfalls.append(
                f"Requested exactly {request.song_count} songs; the proposal contains {len(entries)}."
            )
        if len(entries) < target_count:
            artist = f" matching artist {request.artist!r}" if request.artist else ""
            shortfalls.append(
                f"Requested {target_count} songs, but only {len(entries)} analyzed catalog songs{artist} are available."
            )
        actual_roles = Counter(entry.purpose for entry in entries)
        for role, count in request.ride_types.items():
            if actual_roles[role] < count:
                shortfalls.append(
                    f"Requested {count} {role} track(s), but only {actual_roles[role]} could be assigned."
                )
        if request.duration_minutes is not None:
            actual_minutes = sum(entry.duration for entry in entries) / 60
            tolerance = max(2.0, request.duration_minutes * 0.1)
            if abs(actual_minutes - request.duration_minutes) > tolerance:
                shortfalls.append(
                    f"Requested about {request.duration_minutes:g} minutes; available selections total {actual_minutes:.1f} minutes."
                )
        known_ids = self._catalog.ids()
        valid_ids = all(entry.track_id in known_ids for entry in entries)
        unique = len({entry.track_id for entry in entries}) == len(entries)
        if not valid_ids:
            shortfalls.append("One or more selected track IDs are not present in the catalog.")
        validation = ConstraintValidation(
            valid_track_ids=valid_ids,
            unique_tracks=unique,
            requested_song_count=request.song_count,
            actual_song_count=len(entries),
            requested_duration_minutes=request.duration_minutes,
            actual_duration_minutes=round(sum(entry.duration for entry in entries) / 60, 2),
            requested_ride_types=request.ride_types,
            actual_ride_types={
                role: actual_roles[role] for role in DEFAULT_ROLE_ORDER if actual_roles[role]
            },
            satisfied=not shortfalls and valid_ids and unique,
        )
        status: Literal["complete", "partial", "impossible"] = (
            "complete" if validation.satisfied else ("partial" if entries else "impossible")
        )
        summary = (
            f"Planned {len(entries)} analyzed catalog song(s) for the ride."
            if entries
            else "No analyzed catalog songs satisfy the request."
        )
        return PlaylistProposal(
            status=status,
            understood_request=request,
            summary=summary,
            entries=entries,
            shortfalls=shortfalls,
            validation=validation,
        )

    @staticmethod
    def _hardness(song: CatalogSong) -> float:
        return song.mean_energy + song.peak_energy

    @staticmethod
    def _entry_hardness(entry: PlaylistEntry) -> float:
        return entry.energy * 2

    @staticmethod
    def _ordinal(position: int) -> str:
        suffix = (
            "th"
            if 10 <= position % 100 <= 20
            else {1: "st", 2: "nd", 3: "rd"}.get(position % 10, "th")
        )
        return f"{position}{suffix}"
