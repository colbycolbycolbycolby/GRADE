from pathlib import Path

import pytest

from tests.fixtures.synth import write_fixtures

GENERATED = Path(__file__).resolve().parent / "fixtures" / "generated"


@pytest.fixture(scope="session")
def fixture_wavs() -> dict[str, Path]:
    return write_fixtures(GENERATED)
