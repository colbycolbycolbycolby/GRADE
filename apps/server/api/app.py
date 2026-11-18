from __future__ import annotations

import os
import re
import tempfile
from collections.abc import Iterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated, Any
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, File, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from analysis import Analyzer, LibrosaAnalyzer
from ingest import (
    MAX_DURATION_SEC,
    TRACK_ID_RE,
    AudioIngest,
    FfmpegTranscoder,
    IngestError,
    Store,
    Transcoder,
    YtDlpIngest,
)
from ingest.files import hash_file
from planner import (
    CatalogRepository,
    OpenAIRequestInterpreter,
    OpenAIWorkoutInterpreter,
    PlaylistAgent,
    PlaylistProposal,
    RuleBasedRequestInterpreter,
    RuleBasedWorkoutInterpreter,
    WorkoutInterpretation,
    WorkoutRequestInterpreter,
)
from planner.interpreter import RequestInterpreter

from .jobs import JobQueue, TooManyJobs
from .service import IngestService

STATUS_BY_CODE = {
    "not_found": 404,
    "forbidden": 403,
    "too_many_jobs": 429,
    "range_not_satisfiable": 416,
}
CHUNK = 64 * 1024
DEFAULT_WEB_DIR = Path(__file__).resolve().parents[2] / "web" / "dist"
RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")
MAX_ACTIVE_JOBS = 32


@dataclass(frozen=True)
class Settings:
    data_dir: Path = Path("data")
    max_duration: float = MAX_DURATION_SEC
    max_active_jobs: int = 2
    max_upload_bytes: int = 200 * 1024 * 1024
    allowed_origins: tuple[str, ...] = field(default_factory=tuple)
    # The built web app. The server serves it at `/` when the folder exists. `from_env` sets it.
    web_dir: Path | None = None
    openai_api_key: str | None = field(default=None, repr=False)
    openai_model: str = "gpt-5-mini"

    @staticmethod
    def from_env() -> Settings:
        origins = os.environ.get("GRADE_ALLOWED_ORIGINS", "")
        max_active_jobs = _bounded_int_env("GRADE_MAX_ACTIVE_JOBS", 2, MAX_ACTIVE_JOBS)
        return Settings(
            data_dir=Path(os.environ.get("GRADE_DATA_DIR", "data")),
            max_active_jobs=max_active_jobs,
            allowed_origins=tuple(o.strip() for o in origins.split(",") if o.strip()),
            web_dir=Path(os.environ.get("GRADE_WEB_DIR", DEFAULT_WEB_DIR)),
            openai_api_key=os.environ.get("OPENAI_API_KEY"),
            openai_model=os.environ.get("GRADE_OPENAI_MODEL", "gpt-5-mini"),
        )


def _bounded_int_env(name: str, default: int, maximum: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer from 1 to {maximum}; got {raw!r}") from exc
    if not 1 <= value <= maximum:
        raise ValueError(f"{name} must be an integer from 1 to {maximum}; got {raw!r}")
    return value


class ApiError(Exception):
    def __init__(self, code: str, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status or STATUS_BY_CODE.get(code, 400)


def _error(code: str, message: str, status: int) -> JSONResponse:
    return JSONResponse({"code": code, "message": message}, status_code=status)


def track_id_of(track_id: str) -> str:
    if not TRACK_ID_RE.match(track_id):
        raise ApiError("bad_request", "The track ID is not valid.")
    return track_id


TrackId = Annotated[str, Depends(track_id_of)]


class YoutubeBody(BaseModel):
    url: str


class PlaylistPlanBody(BaseModel):
    request: str
    previous: PlaylistProposal | None = None


class WorkoutInterpretBody(BaseModel):
    request: str


def create_app(
    settings: Settings | None = None,
    ingest: AudioIngest | None = None,
    analyzer: Analyzer | None = None,
    transcoder: Transcoder | None = None,
    playlist_interpreter: RequestInterpreter | None = None,
    workout_interpreter: WorkoutRequestInterpreter | None = None,
) -> FastAPI:
    cfg = settings or Settings.from_env()
    store = Store(cfg.data_dir)
    tools = transcoder or FfmpegTranscoder()
    queue = JobQueue(workers=cfg.max_active_jobs, max_active=cfg.max_active_jobs)
    service = IngestService(
        store,
        queue,
        ingest or YtDlpIngest(store, transcoder=tools, max_duration=cfg.max_duration),
        analyzer or LibrosaAnalyzer(),
        tools,
        cfg.max_duration,
    )
    upload_dir = cfg.data_dir / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    interpreter = playlist_interpreter or (
        OpenAIRequestInterpreter(cfg.openai_api_key, cfg.openai_model)
        if cfg.openai_api_key
        else RuleBasedRequestInterpreter()
    )
    playlist_agent = PlaylistAgent(CatalogRepository(cfg.data_dir), interpreter)
    workout_request_interpreter = workout_interpreter or (
        OpenAIWorkoutInterpreter(cfg.openai_api_key, cfg.openai_model)
        if cfg.openai_api_key
        else RuleBasedWorkoutInterpreter()
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> Any:
        yield
        queue.shutdown()

    app = FastAPI(title="GRADE", lifespan=lifespan)
    if cfg.allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(cfg.allowed_origins),
            allow_methods=["GET", "POST"],
            allow_headers=["*"],
            expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
        )

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return _error(exc.code, exc.message, exc.status)

    @app.exception_handler(RequestValidationError)
    async def _invalid(_: Request, __: RequestValidationError) -> JSONResponse:
        return _error("bad_request", "The request is not valid.", 400)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = "not_found" if exc.status_code == 404 else "bad_request"
        return _error(code, "The request cannot be served.", exc.status_code)

    def check_origin(request: Request) -> None:
        """Allow same-origin calls, calls with no Origin header, and listed origins."""
        origin = request.headers.get("origin")
        if origin is None or origin in cfg.allowed_origins:
            return
        if urlparse(origin).netloc == request.headers.get("host"):
            return
        raise ApiError("forbidden", "This origin is not allowed.")

    guard = [Depends(check_origin)]

    def start(call: Any) -> dict[str, str]:
        try:
            job = call()
        except IngestError as exc:
            raise ApiError(exc.code, exc.message) from exc
        except TooManyJobs as exc:
            raise ApiError("too_many_jobs", "Too many jobs are running. Try again soon.") from exc
        return {"jobId": job.id, "trackId": job.track_id}

    @app.post("/api/ingest/youtube", dependencies=guard)
    def ingest_youtube(body: YoutubeBody) -> dict[str, str]:
        return start(lambda: service.start_youtube(body.url))

    @app.post("/api/ingest/file", dependencies=guard)
    def ingest_file(file: Annotated[UploadFile, File()]) -> dict[str, str]:
        fd, name = tempfile.mkstemp(dir=upload_dir)
        path = Path(name)
        size = 0
        try:
            with os.fdopen(fd, "wb") as out:
                while chunk := file.file.read(1 << 20):
                    size += len(chunk)
                    if size > cfg.max_upload_bytes:
                        raise ApiError("bad_request", "The file is too large.", 413)
                    out.write(chunk)
            if size == 0:
                raise ApiError("bad_request", "The file is empty.")
            track_id = f"file:{hash_file(path)}"
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        title = Path(file.filename or "Untitled").stem or "Untitled"
        return start(lambda: service.start_file(track_id, path, title))

    @app.get("/api/jobs/{job_id}", dependencies=guard)
    def get_job(job_id: str) -> dict[str, object]:
        job = queue.get(job_id)
        if job is None:
            raise ApiError("not_found", "There is no such job.")
        return job.to_dict()

    @app.get("/api/tracks/{track_id}", dependencies=guard)
    def get_track(track_id: TrackId) -> dict[str, Any]:
        track = store.get_track(track_id)
        if track is None:
            raise ApiError("not_found", "There is no such track.")
        return track

    @app.get("/api/tracks/{track_id}/analysis", dependencies=guard)
    def get_analysis(track_id: TrackId) -> dict[str, Any]:
        found = store.get_analysis(track_id)
        if found is None:
            raise ApiError("not_found", "There is no analysis for this track.")
        return found[1]

    @app.get("/api/tracks/{track_id}/audio", dependencies=guard)
    def get_audio(track_id: TrackId, request: Request) -> Response:
        stored = store.stored_audio(track_id)
        if stored is None:
            raise ApiError("not_found", "There is no audio for this track.")
        return _audio_response(stored.play_path, request.headers.get("range"))

    @app.post("/api/playlists/plan", dependencies=guard, response_model=PlaylistProposal)
    def plan_playlist(body: PlaylistPlanBody) -> PlaylistProposal:
        if not body.request.strip():
            raise ApiError("bad_request", "The playlist request cannot be empty.")
        return playlist_agent.plan(body.request, body.previous)

    @app.post("/api/workouts/interpret", dependencies=guard, response_model=WorkoutInterpretation)
    def interpret_workout(body: WorkoutInterpretBody) -> WorkoutInterpretation:
        if not body.request.strip():
            raise ApiError("bad_request", "The workout request cannot be empty.")
        return workout_request_interpreter.interpret(body.request)

    # Last, so that no web file can shadow an `/api` route.
    if cfg.web_dir is not None and (cfg.web_dir / "index.html").is_file():
        app.mount("/", StaticFiles(directory=cfg.web_dir, html=True), name="web")

    return app


def _audio_response(path: Path, range_header: str | None) -> Response:
    size = path.stat().st_size
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=0",
        "Content-Type": "audio/mp4",
    }
    start, end, status = 0, size - 1, 200
    match = RANGE_RE.match(range_header.strip()) if range_header else None
    if match and (match.group(1) or match.group(2)):
        first, last = match.groups()
        if first:
            start = int(first)
            end = min(int(last), size - 1) if last else size - 1
        else:  # suffix range: the last N bytes
            start = max(size - int(last), 0)
        if start >= size or start > end:
            raise ApiError("range_not_satisfiable", "The range is outside the file.", 416)
        status = 206
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    headers["Content-Length"] = str(end - start + 1)
    return StreamingResponse(_read(path, start, end), status_code=status, headers=headers)


def _read(path: Path, start: int, end: int) -> Iterator[bytes]:
    remaining = end - start + 1
    with path.open("rb") as handle:
        handle.seek(start)
        while remaining > 0:
            data = handle.read(min(CHUNK, remaining))
            if not data:
                break
            remaining -= len(data)
            yield data
