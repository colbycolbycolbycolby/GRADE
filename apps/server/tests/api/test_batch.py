from __future__ import annotations

import io
from pathlib import Path

from analysis import ANALYZER_VERSION, LibrosaAnalyzer
from api.batch import read_sources, run_batch
from api.jobs import JobQueue
from api.service import IngestService
from ingest import FfmpegTranscoder, Store, YtDlpIngest
from tests.ingest.test_youtube import FakeClient

VID_A = "dQw4w9WgXcQ"
VID_B = "AAAAAAAAAAA"


def make_service(data_dir: Path, client: FakeClient) -> tuple[IngestService, JobQueue, Store]:
    store = Store(data_dir)
    transcoder = FfmpegTranscoder()
    queue = JobQueue(workers=1, max_active=1)
    service = IngestService(
        store,
        queue,
        YtDlpIngest(store, client, transcoder),
        LibrosaAnalyzer(),
        transcoder,
        15 * 60,
    )
    return service, queue, store


def test_read_sources_ignores_blank_lines_and_comments(tmp_path: Path) -> None:
    source_file = tmp_path / "songs.txt"
    source_file.write_text("\ufeff# authorized sources\n\nhttps://youtu.be/dQw4w9WgXcQ\n")
    assert read_sources(source_file) == [(3, "https://youtu.be/dQw4w9WgXcQ")]


def test_batch_persists_analysis_audio_and_skips_completed_track(
    tmp_path: Path, fixture_wavs: dict[str, Path]
) -> None:
    client = FakeClient(fixture_wavs["pop_a"])
    service, queue, store = make_service(tmp_path, client)
    output = io.StringIO()
    try:
        first = run_batch(
            [(1, f"https://youtu.be/{VID_A}")],
            service,
            output=output,
            poll_interval=0,
        )
        second = run_batch(
            [(1, f"https://www.youtube.com/watch?v={VID_A}")],
            service,
            output=output,
            poll_interval=0,
        )
    finally:
        queue.shutdown()

    assert first.succeeded == (f"yt:{VID_A}",)
    assert second.skipped == (f"yt:{VID_A}",)
    assert (client.info_calls, client.download_calls) == (1, 1)
    assert store.get_track(f"yt:{VID_A}") == {
        "id": f"yt:{VID_A}",
        "source": "youtube",
        "title": "Song",
        "duration": 30.0,
        "aliases": [],
    }
    stored = store.stored_audio(f"yt:{VID_A}")
    assert stored is not None
    assert stored.play_path.stat().st_size > 0 and stored.wav_path.stat().st_size > 0
    version, analysis = store.get_analysis(f"yt:{VID_A}") or (None, {})
    assert version == ANALYZER_VERSION
    assert analysis["trackId"] == f"yt:{VID_A}"
    assert analysis["bpm"] > 0
    assert len(analysis["energy"]) > 0
    assert len(analysis["boundaries"]) > 0
    assert len(analysis["structure"]) > 0
    assert "SUMMARY total=1 succeeded=1 skipped=0 errors=0" in output.getvalue()
    assert "SUMMARY total=1 succeeded=0 skipped=1 errors=0" in output.getvalue()


class FailingClient(FakeClient):
    def info(self, url: str) -> dict[str, object]:
        if VID_A in url:
            raise RuntimeError("one source failed")
        return super().info(url)


def test_batch_continues_after_one_source_fails(
    tmp_path: Path, fixture_wavs: dict[str, Path]
) -> None:
    client = FailingClient(fixture_wavs["edm_b"])
    service, queue, store = make_service(tmp_path, client)
    output = io.StringIO()
    try:
        result = run_batch(
            [(1, f"https://youtu.be/{VID_A}"), (2, f"https://youtu.be/{VID_B}")],
            service,
            output=output,
            poll_interval=0,
        )
    finally:
        queue.shutdown()

    assert result.succeeded == (f"yt:{VID_B}",)
    assert len(result.errors) == 1
    assert result.errors[0][1] == "analysis_failed"
    assert store.get_analysis(f"yt:{VID_B}") is not None
    assert "SUMMARY total=2 succeeded=1 skipped=0 errors=1" in output.getvalue()
