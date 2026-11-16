from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

RideType = Literal["warmup", "hill", "sprint", "recovery", "surprise"]
Intensity = Literal["low", "moderate", "high"]


class RevisionRequest(BaseModel):
    action: Literal["replace"]
    position: int = Field(ge=1)
    ride_type: RideType | None = None
    harder: bool = False


class PlaylistRequest(BaseModel):
    artist: str | None = None
    song_count: int | None = Field(default=None, ge=1, le=100)
    duration_minutes: float | None = Field(default=None, gt=0, le=600)
    intensity: Intensity | None = None
    ride_types: dict[RideType, int] = Field(default_factory=dict)
    revision: RevisionRequest | None = None


class CatalogSong(BaseModel):
    track_id: str
    title: str
    source: str
    duration: float
    bpm: float | None
    mean_energy: float
    peak_energy: float
    energy_variation: float
    boundary_count: int
    section_count: int


class PlaylistEntry(BaseModel):
    position: int
    track_id: str
    title: str
    purpose: RideType
    bpm: float | None
    energy: float
    duration: float
    explanation: str


class ConstraintValidation(BaseModel):
    valid_track_ids: bool
    unique_tracks: bool
    requested_song_count: int | None
    actual_song_count: int
    requested_duration_minutes: float | None
    actual_duration_minutes: float
    requested_ride_types: dict[RideType, int]
    actual_ride_types: dict[RideType, int]
    satisfied: bool


class PlaylistProposal(BaseModel):
    status: Literal["complete", "partial", "impossible"]
    understood_request: PlaylistRequest
    summary: str
    entries: list[PlaylistEntry]
    shortfalls: list[str]
    validation: ConstraintValidation
