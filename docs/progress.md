# Progress

Last update: 2026-11-16 (integration sprint done, device checks open). Source of truth for the plan: `architecture.md`.

## Done (each one is a commit, and `bash scripts/ci.sh` passes)
- M1 Foundation (`74fc42a`): monorepo, lint, format, test runners, CI script.
- M2 Schema and core model (`0a6a930`): `packages/schema` (zod), `packages/core` (edits, invariants, schedule, undo/redo, serialization). 51 core tests.
- M3 Analysis service (`22b8a12`): `apps/server/analysis/`. 23 server tests. Boundary recall v1 = 0.957 on synthetic fixtures.

- M4 Ingest and API: `apps/server/ingest/` and `apps/server/api/`. 66 server tests plus one opt-in live test (`uv run pytest -m live`, passes).

- M5 Playback engine: `apps/web/src/playback/`. `LocalAudioBackend`, `YouTubeEmbedBackend`, `ClassRunner`, `attachLifecycle`. 46 web tests. The device checks in `docs/device-checklist.md` are **not tested** (no real phone was available).

- M6 Client app: `apps/web/src/` has `storage/` (Dexie), `api/` (client), `editor/` (model, store, waveform, class strip, block list, interval form), `app/` (library, import, analyzing, router). 125 web tests, including component tests. Not yet looked at in a real browser.

- M7 Class runner and class plans: `apps/web/src/runner/` (runner screen, mini waveform, energy helpers), `playback/plan.ts` (`PlanPlayer`), `playback/wakelock.ts`, `app/RunPage.svelte`, `app/PlanPage.svelte`. Routes `#/run/program/<id>`, `#/run/plan/<id>`, `#/plan/<id>`. Not seen in a real browser. Device checks 8 to 12 are `not tested`.

- M8 Polish and docs: `README.md`; error text for every API error code (`app/errors.ts`); Settings page (`#/settings`) with theme and glitch effect (`app/settings.ts`); PWA manifest and service worker (`vite.config.ts`, `public/icon.svg`). 190 web tests. Not seen in a real browser.

## Next: nothing is planned
All milestones are built. Open work, in order of value:
1. Run `docs/device-checklist.md` on a real phone. The M8 acceptance rule is **not met** until every item is `passed` or `known issue`.
2. Test the README on a fresh clone (not done).
3. Use `audioBlobs` with a size budget and eviction (section 11).
4. Make PNG icons.

## Integration sprint

- Merged sequential batch ingestion/source review and the catalog-grounded AI playlist planner.
- Added `#/planner`: natural-language generation and revision, visible workout roles/reasons and
  shortfalls, manual reorder/remove/replace, and save to the existing ClassPlan/Program/playback flow.
- Saving preserves canonical track IDs and analysis versions, reuses matching instructor Programs,
  and creates neutral analysis-derived drafts only when no matching Program exists.
- Verified with deterministic analyzed catalog fixtures; production/device playback checks remain open.

## Run the app
Server: `cd apps/server && uv run uvicorn api.app:create_app --factory`. It serves `apps/web/dist` at `/` after `pnpm --filter @grade/web build`. Set `GRADE_DATA_DIR` and `GRADE_ALLOWED_ORIGINS` if needed. `make update-ytdlp` upgrades yt-dlp.
Web: `pnpm --filter @grade/web dev`. Vite sends `/api` to `127.0.0.1:8000`.
Live client test: see the comment at the top of `apps/web/src/api/live.test.ts`.

## How to work here
Start with `CLAUDE.md` in the project root.

- Add `~/.local/bin` to `PATH` (it holds `pnpm`).
- JS checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- Server checks: `cd apps/server && uv run pytest && uv run ruff check . && uv run mypy .`.
- After a schema change in `packages/schema/src`, run `pnpm --filter @grade/schema gen`.
- Log small decisions in `docs/decisions.md`.

## Open items and known gaps
- Stored audio has no size budget or LRU eviction yet (section 11).
- The git repo is local only. There is no remote.
- Fixtures are synthetic. Real royalty-free tracks with labels would test the analyzer better.
- The editor layout, drag handles, and canvas drawing were never seen in a real browser.
- `docs/device-checklist.md` exists, but every item is `not tested`.
- Mobile background audio in a PWA is unverified (section 11). Test it on a phone. The runner (M7) is the build to test.
