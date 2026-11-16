# AI playlist planner

The planner is a server-side feature. It does not acquire audio or run analysis. It reads only
tracks that already have an analysis row in `grade.sqlite3`.

## Local demo

From `apps/server`, make the repository's local key available to the server and start FastAPI:

```bash
set -a
source ../../../../.env.local
set +a
uv sync
uv run uvicorn api:create_app --factory --reload
```

The extra `../..` is because this feature lives in `.worktrees/ai-playlist-planner`. When the branch
is checked out as the main worktree, use `source ../../.env.local` instead.

Create a proposal:

```bash
curl -s http://127.0.0.1:8000/api/playlists/plan \
  -H 'content-type: application/json' \
  -d '{"request":"Make me a cycling playlist with 4 songs: two hills, one sprint, and one surprise."}'
```

For a revision, send the complete prior response as `previous`:

```json
{
  "request": "Replace the first hill with something harder.",
  "previous": { "...": "the prior proposal" }
}
```

`GRADE_OPENAI_MODEL` optionally overrides the default model (`gpt-5-mini`). If no API key is
configured, a deterministic local interpreter keeps catalog search, planning, validation, and the
demo endpoint usable. In both modes, only the server-side catalog tool can select track IDs.

Run the focused tests with:

```bash
uv run pytest tests/planner
```
