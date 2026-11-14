from __future__ import annotations

import re
import shutil
import tempfile
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import parse_qs, urlparse

from .models import MAX_DURATION_SEC, IngestError, StoredAudio, TrackMeta
from .store import PLAY_NAME, WAV_NAME, Store
from .transcode import FfmpegTranscoder, Transcoder

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}
SHORT_HOSTS = {"youtu.be", "www.youtu.be"}
ID_PATH_PREFIXES = ("shorts", "embed", "live", "v")


def normalize_url(url: str) -> str:
    """Return the video ID of a single-video YouTube URL, or raise `IngestError`."""
    text = url.strip()
    if "://" not in text:
        text = "https://" + text
    try:
        parsed = urlparse(text)
        host = (parsed.hostname or "").lower()
    except ValueError as exc:
        raise IngestError("invalid_url", "This is not a valid link.") from exc
    if parsed.scheme not in ("http", "https") or not host:
        raise IngestError("invalid_url", "This is not a valid link.")
    if host not in YOUTUBE_HOSTS and host not in SHORT_HOSTS:
        raise IngestError("unsupported_host", "Only YouTube links are supported.")

    parts = [p for p in parsed.path.split("/") if p]
    query = parse_qs(parsed.query)
    candidate: str | None = None
    if host in SHORT_HOSTS:
        candidate = parts[0] if parts else None
    elif parts and parts[0] == "watch":
        candidate = query.get("v", [None])[0]
    elif len(parts) >= 2 and parts[0] in ID_PATH_PREFIXES:
        candidate = parts[1]
    elif parts and parts[0] == "playlist":
        raise IngestError("playlist_not_supported", "Playlists are not supported. Use one video.")
    if candidate is None or not VIDEO_ID_RE.match(candidate):
        if "list" in query and "v" not in query:
            raise IngestError(
                "playlist_not_supported", "Playlists are not supported. Use one video."
            )
        raise IngestError("invalid_url", "This link does not point to one YouTube video.")
    return candidate


def map_ytdlp_error(message: str) -> IngestError:
    """Map the text of a yt-dlp failure to an error code. Order matters: check age first."""
    low = message.lower()
    if "confirm your age" in low or "age-restricted" in low or "age restricted" in low:
        return IngestError("age_restricted", "This video is age-restricted.")
    if "not a bot" in low or "http error 403" in low or "http error 429" in low or "blocked" in low:
        return IngestError("blocked", "YouTube blocked the request. Try again later.")
    if any(
        key in low
        for key in (
            "unavailable",
            "private video",
            "has been removed",
            "does not exist",
            "terminated",
        )
    ):
        return IngestError("video_unavailable", "This video is not available.")
    return IngestError("download_failed", "The download failed.")


class YtDlpClient(Protocol):
    def info(self, url: str) -> dict[str, Any]: ...
    def download(self, url: str, out_dir: Path) -> Path: ...


class RealYtDlp:
    """The only code that imports yt-dlp. It makes one attempt and never retries."""

    def _options(self) -> dict[str, Any]:
        return {"quiet": True, "no_warnings": True, "noplaylist": True, "retries": 0}

    def info(self, url: str) -> dict[str, Any]:
        import yt_dlp

        try:
            with yt_dlp.YoutubeDL(self._options()) as ydl:
                data = ydl.extract_info(url, download=False)
        except yt_dlp.utils.DownloadError as exc:
            raise map_ytdlp_error(str(exc)) from exc
        return dict(data or {})

    def download(self, url: str, out_dir: Path) -> Path:
        import yt_dlp

        opts = {
            **self._options(),
            "format": "bestaudio/best",
            "outtmpl": str(out_dir / "source.%(ext)s"),
        }
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([url])
        except yt_dlp.utils.DownloadError as exc:
            raise map_ytdlp_error(str(exc)) from exc
        files = sorted(out_dir.glob("source.*"))
        if not files:
            raise IngestError("download_failed", "The download failed.")
        return files[0]


class YtDlpIngest:
    """Implements `AudioIngest` for single YouTube videos."""

    def __init__(
        self,
        store: Store,
        client: YtDlpClient | None = None,
        transcoder: Transcoder | None = None,
        max_duration: float = MAX_DURATION_SEC,
    ) -> None:
        self._store = store
        self._client = client or RealYtDlp()
        self._transcoder = transcoder or FfmpegTranscoder()
        self._max_duration = max_duration

    def resolve(self, url: str) -> TrackMeta:
        video_id = normalize_url(url)
        data = self._client.info(f"https://www.youtube.com/watch?v={video_id}")
        duration = float(data.get("duration") or 0)
        if data.get("is_live") or duration <= 0:
            raise IngestError("video_unavailable", "This video has no fixed length.")
        if duration > self._max_duration:
            raise IngestError(
                "too_long", f"The video is longer than {int(self._max_duration // 60)} minutes."
            )
        return TrackMeta(
            track_id=f"yt:{video_id}",
            source="youtube",
            title=str(data.get("title") or video_id),
            duration=duration,
        )

    def fetch_audio(self, track_id: str) -> StoredAudio:
        stored = self._store.stored_audio(track_id)
        if stored is not None:
            return stored
        video_id = track_id.removeprefix("yt:")
        folder = self._store.audio_dir(track_id)
        with tempfile.TemporaryDirectory(dir=self._store.root) as tmp:
            source = self._client.download(f"https://www.youtube.com/watch?v={video_id}", Path(tmp))
            actual = self._transcoder.duration(source)
            if actual > self._max_duration + 1:
                raise IngestError("too_long", "The video is too long.")
            staging = Path(tmp) / "out"
            self._transcoder.transcode(source, staging / PLAY_NAME, staging / WAV_NAME)
            if folder.exists():
                shutil.rmtree(folder)
            shutil.move(str(staging), str(folder))
        return StoredAudio(track_id, folder / PLAY_NAME, folder / WAV_NAME)
