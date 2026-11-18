from __future__ import annotations

import re
from typing import Literal, Protocol

from openai import OpenAI
from pydantic import BaseModel, ConfigDict, Field

WorkoutRole = Literal["warmup", "climb", "intervals", "sprint", "endurance", "cooldown"]


class WorkoutConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # OpenAI strict schemas require every property; nullable values represent omitted constraints.
    durationMinutes: float | None = Field(gt=0, le=600)
    sequence: list[WorkoutRole] = Field(max_length=100)
    intensity: Literal["easy", "moderate", "hard"] | None
    resistanceZones: list[int] = Field(max_length=5)
    programCount: int | None = Field(ge=1, le=100)
    artistPreferences: list[str] = Field(max_length=20)
    artistExclusions: list[str] = Field(max_length=20)


class WorkoutInterpretation(WorkoutConstraints):
    mode: Literal["deterministic", "openai"] = "deterministic"
    model: str | None = None


class WorkoutRequestInterpreter(Protocol):
    def interpret(self, text: str) -> WorkoutInterpretation: ...


class RuleBasedWorkoutInterpreter:
    def interpret(self, text: str) -> WorkoutInterpretation:
        lower = text.casefold()
        duration = re.search(r"\b(\d+(?:\.\d+)?)\s*[- ]?\s*(?:minute|min)\b", lower)
        count = re.search(r"\b(\d+)\s+(?:programs?|songs?)\b", lower)
        sequence: list[WorkoutRole] = []
        aliases: tuple[tuple[str, WorkoutRole], ...] = (
            (r"warm[ -]?ups?", "warmup"),
            (r"climbs?|hills?", "climb"),
            (r"intervals?", "intervals"),
            (r"sprints?", "sprint"),
            (r"endurance", "endurance"),
            (r"cool[ -]?downs?", "cooldown"),
        )
        matches: list[tuple[int, WorkoutRole, int]] = []
        words = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5}
        for pattern, role in aliases:
            for found in re.finditer(pattern, lower):
                prefix = lower[max(0, found.start() - 12) : found.start()]
                amount_match = re.search(r"(?<!z)(?<!z\s)(\d+|one|two|three|four|five)\s*$", prefix)
                value = (
                    int(amount_match.group(1))
                    if amount_match and amount_match.group(1).isdigit()
                    else words.get(amount_match.group(1), 1)
                    if amount_match
                    else 1
                )
                matches.append((found.start(), role, value))
        for _, role, amount in sorted(matches):
            sequence.extend([role] * amount)
        zones = sorted({int(zone) for zone in re.findall(r"\bz\s*([1-5])\b", lower)})
        intensity: Literal["easy", "moderate", "hard"] | None = None
        if re.search(r"\b(?:hard|intense|high[ -]?intensity)\b", lower):
            intensity = "hard"
        elif re.search(r"\b(?:easy|gentle|low[ -]?intensity)\b", lower):
            intensity = "easy"
        elif re.search(r"\bmoderate\b", lower):
            intensity = "moderate"
        return WorkoutInterpretation(
            durationMinutes=float(duration.group(1)) if duration else None,
            sequence=sequence,
            intensity=intensity,
            resistanceZones=zones,
            programCount=int(count.group(1)) if count else None,
            artistPreferences=[],
            artistExclusions=[],
        )


class OpenAIWorkoutInterpreter:
    def __init__(self, api_key: str, model: str = "gpt-5-mini") -> None:
        self._client = OpenAI(api_key=api_key, timeout=20.0, max_retries=0)
        self._model = model
        self._fallback = RuleBasedWorkoutInterpreter()

    def interpret(self, text: str) -> WorkoutInterpretation:
        try:
            response = self._client.responses.create(
                model=self._model,
                input=[
                    {
                        "role": "system",
                        "content": (
                            "Extract constraints for an indoor-cycling class assembled from existing "
                            "instructor Programs. Preserve the requested workout order and repetitions. "
                            "A song count means Program count. Extract only constraints stated or clearly "
                            "implied by the user. Do not invent Programs, song IDs, cues, workout metadata, "
                            "or artists. Use resistance zones 1 through 5."
                        ),
                    },
                    {"role": "user", "content": text},
                ],
                text={
                    "format": {
                        "type": "json_schema",
                        "name": "workout_constraints",
                        "strict": True,
                        "schema": WorkoutConstraints.model_json_schema(),
                    }
                },
            )
            constraints = WorkoutConstraints.model_validate_json(response.output_text)
            return WorkoutInterpretation(
                **constraints.model_dump(), mode="openai", model=self._model
            )
        except Exception:  # noqa: BLE001 - every API/schema failure must preserve local planning
            return self._fallback.interpret(text)
