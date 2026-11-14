from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Protocol

from .models import IngestError

WAV_RATE = 22050


class Transcoder(Protocol):
    def duration(self, src: Path) -> float: ...
    def transcode(self, src: Path, play_path: Path, wav_path: Path) -> None: ...


class FfmpegTranscoder:
    """Makes the playback copy (AAC in m4a) and the mono analysis WAV."""

    def duration(self, src: Path) -> float:
        cmd = [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(src),
        ]
        try:
            out = subprocess.run(cmd, capture_output=True, check=True, timeout=60)
            return float(json.loads(out.stdout)["format"]["duration"])
        except (subprocess.SubprocessError, KeyError, ValueError, OSError) as exc:
            raise IngestError(
                "unsupported_audio", "The file is not audio that we can read."
            ) from exc

    def transcode(self, src: Path, play_path: Path, wav_path: Path) -> None:
        play_path.parent.mkdir(parents=True, exist_ok=True)
        cmd = [
            "ffmpeg", "-y", "-v", "error", "-i", str(src), "-vn",
            "-c:a", "aac", "-b:a", "128k", str(play_path),
            "-vn", "-ac", "1", "-ar", str(WAV_RATE), "-c:a", "pcm_s16le", str(wav_path),
        ]  # fmt: skip
        try:
            subprocess.run(cmd, capture_output=True, check=True, timeout=600)
        except (subprocess.SubprocessError, OSError) as exc:
            play_path.unlink(missing_ok=True)
            wav_path.unlink(missing_ok=True)
            raise IngestError("unsupported_audio", "The audio could not be converted.") from exc
