import json
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import jsonschema
import pytest
from fastapi.testclient import TestClient

from analysis import ANALYZER_VERSION, Analysis
from api import Settings, create_app
from tests.ingest.test_youtube import VID, FakeClient

ROOT = Path(__file__).resolve().parents[4]
SCHEMA: dict[str, Any] = json.loads((ROOT / "packages/schema/json/schema.json").read_text())
URL = f"https://www.youtube.com/watch?v={VID}"


def check(name: str, payload: Any) -> None:
    jsonschema.validate(payload, {**SCHEMA, "$ref": f"#/definitions/{name}"})


class GatedAnalyzer:
    """Waits for `gate` so a test can hold jobs in the running state."""

    def __init__(self) -> None:
        self.gate = threading.Event()
        self.calls = 0

    def analyze(self, wav_path: str, progress: Callable[[float], None] | None = None) -> Analysis:
        self.calls += 1
        self.gate.wait(10)
        return Analysis("", ANALYZER_VERSION, 1.0, [(0.0, 0.5)], [], [], 0.0, 1.0, "2026-01-01")


def wait_for(client: TestClient, job_id: str, want: str = "done") -> dict[str, Any]:
    for _ in range(300):
        body: dict[str, Any] = client.get(f"/api/jobs/{job_id}").json()
        check("JobStatus", body)
        if body["status"] in ("done", "error"):
            assert body["status"] == want, body
            return body
        time.sleep(0.05)
    raise AssertionError("job did not finish")


@pytest.fixture
def yt(fixture_wavs: dict[str, Path]) -> FakeClient:
    return FakeClient(fixture_wavs["pop_a"])


@pytest.fixture
def client(tmp_path: Path, yt: FakeClient) -> Iterator[TestClient]:
    from ingest import FfmpegTranscoder, Store, YtDlpIngest

    app = create_app(
        Settings(data_dir=tmp_path), ingest=YtDlpIngest(Store(tmp_path), yt, FfmpegTranscoder())
    )
    with TestClient(app) as c:
        yield c


def test_youtube_flow_and_contract(client: TestClient, yt: FakeClient) -> None:
    res = client.post("/api/ingest/youtube", json={"url": URL})
    assert res.status_code == 200
    check("IngestResponse", res.json())
    assert res.json()["trackId"] == f"yt:{VID}"
    job = wait_for(client, res.json()["jobId"])
    assert job["progress"] == 1.0

    track = client.get(f"/api/tracks/yt:{VID}").json()
    check("Track", track)
    assert track["title"] == "Song" and track["aliases"] == []
    analysis = client.get(f"/api/tracks/yt:{VID}/analysis").json()
    check("Analysis", analysis)
    assert analysis["trackId"] == f"yt:{VID}"
    assert client.get(f"/api/tracks/yt:{VID}/audio").status_code == 200


def test_repeat_request_hits_the_cache(client: TestClient, yt: FakeClient) -> None:
    first = client.post("/api/ingest/youtube", json={"url": URL}).json()
    wait_for(client, first["jobId"])
    second = client.post("/api/ingest/youtube", json={"url": f"https://youtu.be/{VID}"}).json()
    assert second["jobId"] != first["jobId"]
    assert client.get(f"/api/jobs/{second['jobId']}").json()["status"] == "done"
    assert (yt.info_calls, yt.download_calls) == (1, 1)


def test_one_job_per_video_and_two_active_jobs(tmp_path: Path, yt: FakeClient) -> None:
    from ingest import FfmpegTranscoder, Store, YtDlpIngest

    analyzer = GatedAnalyzer()
    app = create_app(
        Settings(data_dir=tmp_path),
        ingest=YtDlpIngest(Store(tmp_path), yt, FfmpegTranscoder()),
        analyzer=analyzer,
    )
    with TestClient(app) as client:
        a = client.post("/api/ingest/youtube", json={"url": URL}).json()
        again = client.post("/api/ingest/youtube", json={"url": URL}).json()
        assert again["jobId"] == a["jobId"]
        b = client.post("/api/ingest/youtube", json={"url": "https://youtu.be/AAAAAAAAAAA"})
        assert b.status_code == 200
        c = client.post("/api/ingest/youtube", json={"url": "https://youtu.be/BBBBBBBBBBB"})
        assert c.status_code == 429
        assert c.json()["code"] == "too_many_jobs"
        analyzer.gate.set()
        wait_for(client, a["jobId"])
        wait_for(client, b.json()["jobId"])
        ok = client.post("/api/ingest/youtube", json={"url": "https://youtu.be/BBBBBBBBBBB"})
        assert ok.status_code == 200  # a slot is free again
        wait_for(client, ok.json()["jobId"])


def test_one_active_job_limit_keeps_duplicate_coalescing(tmp_path: Path, yt: FakeClient) -> None:
    analyzer = GatedAnalyzer()
    app = create_app(
        Settings(data_dir=tmp_path, max_active_jobs=1),
        ingest=yt_ingest(tmp_path, yt),
        analyzer=analyzer,
    )
    with TestClient(app) as client:
        first = client.post("/api/ingest/youtube", json={"url": URL})
        assert first.status_code == 200

        duplicate = client.post("/api/ingest/youtube", json={"url": URL})
        assert duplicate.status_code == 200
        assert duplicate.json()["jobId"] == first.json()["jobId"]

        distinct = client.post("/api/ingest/youtube", json={"url": "https://youtu.be/AAAAAAAAAAA"})
        assert distinct.status_code == 429
        assert distinct.json()["code"] == "too_many_jobs"

        analyzer.gate.set()
        wait_for(client, first.json()["jobId"])
        assert analyzer.calls == 1


def test_max_active_jobs_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GRADE_MAX_ACTIVE_JOBS", raising=False)
    assert Settings.from_env().max_active_jobs == 2

    monkeypatch.setenv("GRADE_MAX_ACTIVE_JOBS", "1")
    assert Settings.from_env().max_active_jobs == 1


@pytest.mark.parametrize("value", ["0", "-1", "33", "1.5", "two", ""])
def test_invalid_max_active_jobs_environment_fails(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    monkeypatch.setenv("GRADE_MAX_ACTIVE_JOBS", value)
    with pytest.raises(ValueError, match="GRADE_MAX_ACTIVE_JOBS must be an integer from 1 to 32"):
        Settings.from_env()


def test_too_long_video_ends_in_an_error(tmp_path: Path, yt: FakeClient) -> None:
    from ingest import FfmpegTranscoder, Store, YtDlpIngest

    yt.duration = 16 * 60
    app = create_app(
        Settings(data_dir=tmp_path), ingest=YtDlpIngest(Store(tmp_path), yt, FfmpegTranscoder())
    )
    with TestClient(app) as client:
        job = client.post("/api/ingest/youtube", json={"url": URL}).json()
        body = wait_for(client, job["jobId"], want="error")
        assert body["error"]["code"] == "too_long"
        assert yt.download_calls == 0


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"url": "https://vimeo.com/1"}, "unsupported_host"),
        ({"url": "https://www.youtube.com/playlist?list=PL1"}, "playlist_not_supported"),
        ({"url": "nonsense://"}, "invalid_url"),
        ({}, "bad_request"),
    ],
)
def test_bad_youtube_requests(client: TestClient, body: dict[str, Any], code: str) -> None:
    res = client.post("/api/ingest/youtube", json=body)
    assert res.status_code == 400
    check("ApiError", res.json())
    assert res.json()["code"] == code


def test_file_flow_and_cache(client: TestClient, fixture_wavs: dict[str, Path]) -> None:
    data = fixture_wavs["edm_b"].read_bytes()
    res = client.post("/api/ingest/file", files={"file": ("My Song.wav", data, "audio/wav")})
    assert res.status_code == 200
    track_id = res.json()["trackId"]
    assert track_id.startswith("file:")
    wait_for(client, res.json()["jobId"])
    track = client.get(f"/api/tracks/{track_id}").json()
    check("Track", track)
    assert track["title"] == "My Song" and track["source"] == "file"
    check("Analysis", client.get(f"/api/tracks/{track_id}/analysis").json())

    again = client.post("/api/ingest/file", files={"file": ("copy.wav", data, "audio/wav")}).json()
    assert again["trackId"] == track_id
    assert client.get(f"/api/jobs/{again['jobId']}").json()["status"] == "done"


def test_file_that_is_not_audio(client: TestClient) -> None:
    res = client.post(
        "/api/ingest/file", files={"file": ("x.mp3", b"not audio at all", "audio/mpeg")}
    )
    body = wait_for(client, res.json()["jobId"], want="error")
    assert body["error"]["code"] == "unsupported_audio"


def test_empty_upload_is_rejected(client: TestClient) -> None:
    res = client.post("/api/ingest/file", files={"file": ("x.wav", b"", "audio/wav")})
    assert res.status_code == 400 and res.json()["code"] == "bad_request"


def test_upload_size_limit(tmp_path: Path, yt: FakeClient) -> None:
    app = create_app(
        Settings(data_dir=tmp_path, max_upload_bytes=10), ingest=yt_ingest(tmp_path, yt)
    )
    with TestClient(app) as client:
        res = client.post("/api/ingest/file", files={"file": ("x.wav", b"x" * 11, "audio/wav")})
        assert res.status_code == 413 and res.json()["code"] == "bad_request"
        assert list((tmp_path / "uploads").iterdir()) == []


def yt_ingest(tmp_path: Path, yt: FakeClient) -> Any:
    from ingest import FfmpegTranscoder, Store, YtDlpIngest

    return YtDlpIngest(Store(tmp_path), yt, FfmpegTranscoder())


@pytest.fixture
def audio_client(client: TestClient) -> TestClient:
    job = client.post("/api/ingest/youtube", json={"url": URL}).json()
    wait_for(client, job["jobId"])
    return client


def test_audio_range_requests(audio_client: TestClient) -> None:
    url = f"/api/tracks/yt:{VID}/audio"
    full = audio_client.get(url)
    size = len(full.content)
    assert full.status_code == 200 and size > 1000
    assert full.headers["accept-ranges"] == "bytes"
    assert int(full.headers["content-length"]) == size

    part = audio_client.get(url, headers={"Range": "bytes=0-99"})
    assert part.status_code == 206
    assert part.headers["content-range"] == f"bytes 0-99/{size}"
    assert part.content == full.content[:100]

    open_end = audio_client.get(url, headers={"Range": "bytes=500-"})
    assert open_end.status_code == 206 and open_end.content == full.content[500:]

    suffix = audio_client.get(url, headers={"Range": "bytes=-64"})
    assert suffix.status_code == 206 and suffix.content == full.content[-64:]

    clipped = audio_client.get(url, headers={"Range": f"bytes={size - 10}-{size + 500}"})
    assert clipped.headers["content-range"] == f"bytes {size - 10}-{size - 1}/{size}"

    bad = audio_client.get(url, headers={"Range": f"bytes={size}-"})
    assert bad.status_code == 416
    assert bad.json()["code"] == "range_not_satisfiable"
    check("ApiError", bad.json())

    ignored = audio_client.get(url, headers={"Range": "items=1-2"})
    assert ignored.status_code == 200 and ignored.content == full.content


def test_origin_check(audio_client: TestClient) -> None:
    url = f"/api/tracks/yt:{VID}/audio"
    same = audio_client.get(url, headers={"Origin": "http://testserver"})
    assert same.status_code == 200
    other = audio_client.get(url, headers={"Origin": "https://evil.example"})
    assert other.status_code == 403
    assert other.json()["code"] == "forbidden"


def test_allowed_origin_setting(tmp_path: Path, yt: FakeClient) -> None:
    settings = Settings(data_dir=tmp_path, allowed_origins=("http://localhost:5173",))
    with TestClient(create_app(settings, ingest=yt_ingest(tmp_path, yt))) as client:
        res = client.get("/api/jobs/x", headers={"Origin": "http://localhost:5173"})
        assert res.status_code == 404  # passed the origin check
        assert res.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_not_found_and_bad_ids(client: TestClient) -> None:
    for path in ("/api/jobs/nope", f"/api/tracks/yt:{VID}", f"/api/tracks/yt:{VID}/analysis"):
        res = client.get(path)
        assert res.status_code == 404 and res.json()["code"] == "not_found"
        check("ApiError", res.json())
    for path in ("/api/tracks/..%2Fetc", "/api/tracks/yt:short/audio"):
        res = client.get(path)
        assert res.status_code in (400, 404)
        check("ApiError", res.json())
    assert client.get("/api/tracks/yt:short").json()["code"] == "bad_request"


def test_audio_is_not_in_a_served_folder(audio_client: TestClient, tmp_path: Path) -> None:
    assert audio_client.get("/audio/yt_" + VID + "/play.m4a").status_code == 404
    assert audio_client.get("/data/audio").status_code == 404


def test_serves_the_built_web_app_and_keeps_the_api(tmp_path: Path, yt: FakeClient) -> None:
    from ingest import FfmpegTranscoder, Store, YtDlpIngest

    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<title>GRADE</title>")
    (web / "sw.js").write_text("// worker")
    app = create_app(
        Settings(data_dir=tmp_path, web_dir=web),
        ingest=YtDlpIngest(Store(tmp_path), yt, FfmpegTranscoder()),
    )
    with TestClient(app) as c:
        assert "<title>GRADE</title>" in c.get("/").text
        assert c.get("/sw.js").text == "// worker"
        missing = c.get("/api/jobs/nope")
        assert missing.status_code == 404
        assert missing.json()["code"] == "not_found"
        assert c.get("/api/nothing").json()["code"] == "not_found"


def test_without_a_web_folder_the_root_is_not_found(tmp_path: Path, yt: FakeClient) -> None:
    from ingest import FfmpegTranscoder, Store, YtDlpIngest

    app = create_app(
        Settings(data_dir=tmp_path, web_dir=tmp_path / "missing"),
        ingest=YtDlpIngest(Store(tmp_path), yt, FfmpegTranscoder()),
    )
    with TestClient(app) as c:
        assert c.get("/").status_code == 404
