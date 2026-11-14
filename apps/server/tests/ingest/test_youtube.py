from pathlib import Path
from typing import Any

import pytest

from ingest import FfmpegTranscoder, IngestError, Store, YtDlpIngest, normalize_url
from ingest.youtube import map_ytdlp_error

VID = "dQw4w9WgXcQ"


@pytest.mark.parametrize(
    "url",
    [
        f"https://www.youtube.com/watch?v={VID}",
        f"youtube.com/watch?v={VID}&t=42s",
        f"https://youtu.be/{VID}?si=abc",
        f"https://m.youtube.com/watch?v={VID}",
        f"https://music.youtube.com/watch?v={VID}",
        f"https://www.youtube.com/shorts/{VID}",
        f"https://www.youtube.com/embed/{VID}",
        f"https://www.youtube.com/watch?v={VID}&list=PLabc",
    ],
)
def test_normalize_accepts_single_videos(url: str) -> None:
    assert normalize_url(url) == VID


@pytest.mark.parametrize(
    ("url", "code"),
    [
        ("", "invalid_url"),
        ("not a url", "unsupported_host"),
        ("ftp://youtube.com/watch?v=" + VID, "invalid_url"),
        ("https://vimeo.com/12345", "unsupported_host"),
        ("https://evil.example/youtube.com/watch?v=" + VID, "unsupported_host"),
        ("https://www.youtube.com/playlist?list=PLabc", "playlist_not_supported"),
        ("https://www.youtube.com/watch?list=PLabc", "playlist_not_supported"),
        ("https://www.youtube.com/watch?v=short", "invalid_url"),
        ("https://www.youtube.com/", "invalid_url"),
    ],
)
def test_normalize_rejects(url: str, code: str) -> None:
    with pytest.raises(IngestError) as caught:
        normalize_url(url)
    assert caught.value.code == code


@pytest.mark.parametrize(
    ("message", "code"),
    [
        ("ERROR: Sign in to confirm your age. This video may be inappropriate", "age_restricted"),
        ("ERROR: Sign in to confirm you’re not a bot", "blocked"),
        ("ERROR: unable to download: HTTP Error 403: Forbidden", "blocked"),
        ("ERROR: Video unavailable", "video_unavailable"),
        ("ERROR: Private video. Sign in", "video_unavailable"),
        ("ERROR: something strange", "download_failed"),
    ],
)
def test_map_ytdlp_error(message: str, code: str) -> None:
    assert map_ytdlp_error(message).code == code


class FakeClient:
    def __init__(self, wav: Path, duration: float = 30.0) -> None:
        self.wav = wav
        self.duration = duration
        self.info_calls = 0
        self.download_calls = 0

    def info(self, url: str) -> dict[str, Any]:
        self.info_calls += 1
        return {"title": "Song", "duration": self.duration}

    def download(self, url: str, out_dir: Path) -> Path:
        self.download_calls += 1
        target = out_dir / "source.wav"
        target.write_bytes(self.wav.read_bytes())
        return target


def test_resolve_and_fetch_keep_audio(tmp_path: Path, fixture_wavs: dict[str, Path]) -> None:
    store = Store(tmp_path)
    client = FakeClient(fixture_wavs["pop_a"])
    ingest = YtDlpIngest(store, client, FfmpegTranscoder())
    meta = ingest.resolve(f"https://youtu.be/{VID}")
    assert (meta.track_id, meta.title, meta.source) == (f"yt:{VID}", "Song", "youtube")
    stored = ingest.fetch_audio(meta.track_id)
    assert stored.play_path.is_file() and stored.wav_path.is_file()
    again = ingest.fetch_audio(meta.track_id)
    assert again == stored
    assert client.download_calls == 1  # the second call used the stored copy


def test_resolve_enforces_duration(tmp_path: Path, fixture_wavs: dict[str, Path]) -> None:
    ingest = YtDlpIngest(Store(tmp_path), FakeClient(fixture_wavs["pop_a"], 901), max_duration=900)
    with pytest.raises(IngestError) as caught:
        ingest.resolve(f"https://youtu.be/{VID}")
    assert caught.value.code == "too_long"


def test_resolve_rejects_live_streams(tmp_path: Path, fixture_wavs: dict[str, Path]) -> None:
    ingest = YtDlpIngest(Store(tmp_path), FakeClient(fixture_wavs["pop_a"], 0))
    with pytest.raises(IngestError) as caught:
        ingest.resolve(f"https://youtu.be/{VID}")
    assert caught.value.code == "video_unavailable"
