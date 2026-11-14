import json
from pathlib import Path

from tests.fixtures.synth import SONGS, labels

FIXTURES = Path(__file__).parent / "fixtures"


def test_committed_labels_match_the_generator() -> None:
    """Labels are committed as *.labels.json. They must agree with the specs that make the audio."""
    for spec in SONGS:
        path = FIXTURES / f"{spec.name}.labels.json"
        assert path.exists(), f"missing {path.name}"
        assert json.loads(path.read_text()) == labels(spec)
