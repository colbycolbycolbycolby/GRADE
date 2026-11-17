from __future__ import annotations

import json
import re
from typing import Protocol

from openai import OpenAI

from .models import PlaylistProposal, PlaylistRequest, RevisionRequest, RideType

NUMBER_WORDS = {
    "a": 1,
    "an": 1,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
}
RIDE_WORDS: dict[str, RideType] = {
    "climb": "hill",
    "climbs": "hill",
    "hill": "hill",
    "hills": "hill",
    "sprint": "sprint",
    "sprints": "sprint",
    "warmup": "warmup",
    "warmups": "warmup",
    "warm-up": "warmup",
    "recovery": "recovery",
    "recoveries": "recovery",
    "surprise": "surprise",
    "surprises": "surprise",
}


class RequestInterpreter(Protocol):
    def interpret(self, text: str, previous: PlaylistProposal | None = None) -> PlaylistRequest: ...


class RuleBasedRequestInterpreter:
    """Predictable local interpreter used for tests and as an API outage fallback."""

    def interpret(self, text: str, previous: PlaylistProposal | None = None) -> PlaylistRequest:
        lower = text.casefold()
        request = (
            previous.understood_request.model_copy(deep=True)
            if previous is not None
            else PlaylistRequest()
        )
        request.revision = None

        count = re.search(
            r"\b(\d+|" + "|".join(NUMBER_WORDS) + r")(?:-|\s+)songs?\b", lower
        )
        if count:
            request.song_count = self._number(count.group(1))
        duration = re.search(r"\b(\d+(?:\.\d+)?)\s*(?:minute|min)\b", lower)
        if duration:
            request.duration_minutes = float(duration.group(1))

        artist = re.search(
            r"(?:make|build|create)(?:\s+me)?(?:\s+a|\s+an)?"
            r"(?:\s+(?:\d+|" + "|".join(NUMBER_WORDS) + r")-?songs?)?"
            r"\s+(.+?)\s+(?:cycling\s+)?(?:playlist|class|ride)\b",
            text,
            re.IGNORECASE,
        )
        if artist:
            value = re.sub(r"^(?:a|an)\s+", "", artist.group(1), flags=re.IGNORECASE).strip()
            looks_like_constraints = re.search(
                r"\b(?:\d+|minute|min|song|low|moderate|high|intensity|hill|climb|sprint|recovery|surprise)\b",
                value,
                re.IGNORECASE,
            )
            request.artist = (
                None
                if value.casefold() in {"", "a", "an", "cycling"} or looks_like_constraints
                else value
            )

        for label in ("low", "moderate", "high"):
            if re.search(rf"\b{label}(?:-intensity|\s+intensity)?\b", lower):
                request.intensity = label

        ride_types = dict(request.ride_types)
        found_types = False
        number_token = r"(\d+|" + "|".join(NUMBER_WORDS) + r")"
        for match in re.finditer(number_token + r"\s+([a-z-]+)", lower):
            ride_type = RIDE_WORDS.get(match.group(2))
            if ride_type:
                if not found_types and previous is None:
                    ride_types = {}
                found_types = True
                ride_types[ride_type] = self._number(match.group(1))
        if found_types:
            request.ride_types = ride_types

        revision = re.search(
            r"replace\s+the\s+(\d+|first|second|third|fourth|fifth)(?:\s+(hill|sprint|warmup|warm-up|recovery|surprise))?",
            lower,
        )
        if revision:
            ordinals = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5}
            position = (
                int(revision.group(1))
                if revision.group(1).isdigit()
                else ordinals[revision.group(1)]
            )
            role = RIDE_WORDS.get(revision.group(2)) if revision.group(2) else None
            request.revision = RevisionRequest(
                action="replace",
                position=position,
                ride_type=role,
                harder="harder" in lower,
            )
        return request

    @staticmethod
    def _number(value: str) -> int:
        return int(value) if value.isdigit() else NUMBER_WORDS[value]


class OpenAIRequestInterpreter:
    """Uses a model only to turn language into constraints; catalog truth stays server-side."""

    def __init__(self, api_key: str, model: str = "gpt-5-mini") -> None:
        self._client = OpenAI(api_key=api_key)
        self._model = model
        self._fallback = RuleBasedRequestInterpreter()

    def interpret(self, text: str, previous: PlaylistProposal | None = None) -> PlaylistRequest:
        prior = previous.model_dump(mode="json") if previous else None
        try:
            response = self._client.responses.create(
                model=self._model,
                input=[
                    {
                        "role": "system",
                        "content": (
                            "Extract indoor-cycling playlist constraints. Do not name or invent songs. "
                            "Ride types are warmup, hill, sprint, recovery, surprise. Treat climb "
                            "as hill and articles like 'a sprint' as a count of one. For revisions, "
                            "position is the ordinal within the named ride type, not the playlist index."
                        ),
                    },
                    {
                        "role": "user",
                        "content": json.dumps({"request": text, "previous": prior}),
                    },
                ],
                text={
                    "format": {
                        "type": "json_schema",
                        "name": "playlist_request",
                        "strict": True,
                        "schema": PlaylistRequest.model_json_schema(),
                    }
                },
            )
            interpreted = PlaylistRequest.model_validate_json(response.output_text)
            local = self._fallback.interpret(text, previous)
            if not interpreted.ride_types:
                interpreted.ride_types = local.ride_types
            if interpreted.artist is None:
                interpreted.artist = local.artist
            if interpreted.song_count is None:
                interpreted.song_count = local.song_count
            if interpreted.duration_minutes is None:
                interpreted.duration_minutes = local.duration_minutes
            if interpreted.intensity is None:
                interpreted.intensity = local.intensity
            if interpreted.revision is None:
                interpreted.revision = local.revision
            return interpreted
        except Exception:  # noqa: BLE001 - model/network failure must leave local planning usable
            return self._fallback.interpret(text, previous)
