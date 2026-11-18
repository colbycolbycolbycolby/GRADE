# GRADE demo readiness

Status date: November 18, 2026 (America/New_York)

## Build and demo location

- Development branch: `codex/emergency-ai-planner`
- Sprint starting commit: `c18d2458d011a492f67928da1206fef169812688`
- Final implementation commit: `257c48ff21d6b14496e705bb4167274336635c2c`
- Isolated demo URL: `http://127.0.0.1:8027/#/planner`
- Stable Safari origins `8010` and `8021` were not modified, cleared, migrated, or imported into.

From this worktree, start the demo with:

```sh
pnpm --filter @grade/web build
cd apps/server
set -a
source ../../.env.local
set +a
GRADE_WEB_DIR=../web/dist uv run uvicorn api.app:create_app --factory --host 127.0.0.1 --port 8027
```

The `.env.local` file is ignored by Git. Do not copy its contents into logs, commits, screenshots, or this report.

## Verified model behavior

- Configured and live-verified model: `gpt-5-mini`.
- One controlled live request succeeded with no SDK retries and a 20-second timeout.
- The verified response interpreted 30 minutes, hard intensity, Z4, six Programs, and the sequence warmup → two climbs → intervals → sprint → cooldown.
- The model returns only validated request constraints. It never receives authority to select or create Program IDs, songs, cues, section boundaries, or workout metadata.
- Existing deterministic selection chooses only saved Programs and excludes names marked `AI draft` plus unprogrammed Programs.
- The planner UI says `OpenAI interpretation (gpt-5-mini)` only after a valid model response. Network, timeout, configuration, or schema failures display `deterministic local interpretation and workout scoring (no successful model call)`.

## Recommended presentation prompts

These prompts exercise different supported constraints with the verified 48-Program backup (11 instructor-programmed eligible Programs and 37 excluded AI drafts):

1. `Build a 30-minute class with a warmup, two climbs, sprint intervals, and a cooldown; use 8 Programs.`
   - Expected: warmup first, cooldown last, climb/sprint/interval roles between them, existing Program IDs only, and an honest shortfall if a role has no strong library match.
2. `Build a hard 30-minute class emphasizing Z4 with 7 Programs.`
   - Expected: higher-Z4 and hard/all-out programmed rides score above weaker matches.
3. `Build a 20-minute endurance class with 5 Programs.`
   - Expected: a materially different endurance-oriented sequence and a duration warning when whole Programs cannot land within tolerance.

The selector preserves whole instructor Programs, so actual duration can differ from the request. A request for an unavailable artist, excessive Program count, or unsupported role should produce a visible library limitation instead of invented content.

## Verification completed

- Automated: web unit/component/runner tests, server tests, lint/format/type checks, and production build.
- Automated fallback coverage: a forced interpretation endpoint failure falls back locally and the UI states that no model call succeeded.
- Live OpenAI: the controlled request described above returned a validated `openai` result from `gpt-5-mini`.
- Safari 8027 workflow: entered a natural-language request, received accurate OpenAI status and deterministic Program selection, reviewed explanations/shortfalls, saved a ClassPlan, opened it in the editor, and launched the runner.
- Runner regression fix: YouTube tracks now use the iframe backend rather than the local-audio endpoint. The live runner displayed the saved cue `Z2 70 Seated`, a `0:55` block countdown, and the next three saved cues. No Program content was rewritten.
- Actual instructor testing: not performed. Browser checks were autonomous engineering verification, not an instructor usability sign-off.

## Safari 8021 data audit

- Read-only visual inspection of the active Safari `8021` library showed 48 Programs and one eight-song ClassPlan.
- The existing timestamped `grade-8021-pre-import-backup-2026-11-18.json` contains zero records in every store. It is **not** a valid backup of the visible 8021 library and must not be used for recovery.
- A verified read-only `8010` export from `2026-11-18T15:54:54.014Z` contains 47 tracks, 47 analyses, 48 Programs, one ClassPlan, and one setting. Of the 48 Programs, 11 are instructor-programmed eligible entries and 37 are AI drafts. It contains no audio blobs.
- A fresh filesystem copy of Safari's 8021 IndexedDB could not be created: macOS privacy controls denied read access to Safari website storage, including under an elevated read-only attempt. No source database was changed.
- For tomorrow's presentation, keep Safari 8021 open only as the stable reference. Do not clear website data, import into 8021, run migrations there, or use its Delete controls. Use 8027 for the AI demo.

## Recovery and known limitations

- If OpenAI is unavailable, continue normally: the planner automatically uses the deterministic parser and reports the fallback accurately. No restart is required.
- If `OPENAI_API_KEY` is absent when the server starts, every request uses deterministic interpretation.
- Whole-Program planning cannot hit every requested duration exactly and cannot satisfy constraints absent from the eligible library.
- The current isolated Safari 8027 origin contains only one copied instructor Program. It proves the end-to-end save and runner path but cannot demonstrate meaningful request-to-request variety. For the strongest presentation, populate a separate isolated origin from a verified backup; do not import into 8021.
- YouTube runner playback requires access to the YouTube iframe API and the referenced video. Local uploaded audio retains sample-accurate playback; YouTube playback does not support sample-accurate crossfades.
- No remaining code blocker was found after the YouTube backend fix. The data-copy limitation above is the main presentation constraint.
