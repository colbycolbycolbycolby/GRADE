"""Opt-in test against real YouTube. Run with `uv run pytest -m live`."""

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import Settings, create_app

# "Me at the zoo": the first YouTube video, 19 seconds long.
URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw"


@pytest.mark.live
def test_real_youtube_ingest(tmp_path: Path) -> None:
    with TestClient(create_app(Settings(data_dir=tmp_path))) as client:
        job = client.post("/api/ingest/youtube", json={"url": URL}).json()
        body = {}
        for _ in range(240):
            body = client.get(f"/api/jobs/{job['jobId']}").json()
            if body["status"] in ("done", "error"):
                break
            time.sleep(1)
        assert body["status"] == "done", body
        assert client.get(f"/api/tracks/{job['trackId']}/analysis").status_code == 200
        ranged = client.get(f"/api/tracks/{job['trackId']}/audio", headers={"Range": "bytes=0-9"})
        assert ranged.status_code == 206
