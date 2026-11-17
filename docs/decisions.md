# Decisions

- Analysis gets an optional `structure` field (kind + similarTo index per section) because Segment kind/similarTo need clustering output the original schema had no place for.
- Tier is computed in `packages/core` (`programFromAnalysis`) from analysis energy, not in the Python analyzer; keeps thresholds in one place.
- Analysis times are original-file time; `programFromAnalysis` subtracts `cropStart`. Boundaries must lie strictly inside (cropStart, cropEnd).
- Structural edits re-fit clips with `reflowClips`: clips are real time, so each is cut at new segment edges; pieces under 1 s are dropped; if no clip survives the order resets to chronological.
- `deleteSegment` drops the clips of the deleted segment; the next segment (previous, if last) absorbs the time. Legacy did the same to time but reset the whole order.
- `splitSegment` never copies `label` to the new part (legacy bug A.5).
- `generateIntervals` keeps clips of the kept part and appends new interval clips; legacy reset the whole order. A tail under 2 s joins the last interval; a start that leaves under 2 s in the straddling segment snaps to that segment's start.
- Core ops take an optional `{ newId }` so tests are deterministic; default is `crypto.randomUUID()`.
- Genuine cut compares with a small float tolerance (`> 0.05 + 1e-6`).
- Git identity is repo-local (user.name `snow`).
- M3 silence trim is judged on `level` (smoothed RMS divided by its maximum), not on the min-max curve. On the min-max curve the quietest part of any track reads 0, so a quiet intro was cropped as silence. Tier energy still uses min-max as in the legacy app.
- M3 downbeats assume 4/4: the bar phase with the strongest mean onset strength. Boundaries snap to a downbeat within 1 s, else to a beat within half a beat period. Where there are no beats (pads only) boundaries are not snapped.
- M3 fallback segmentation now joins neighbors of the same tier after it merges a short segment (legacy left two adjacent same-tier segments).
- M3 fixtures are synthetic songs (`apps/server/tests/fixtures/synth.py`). The WAVs are generated into `fixtures/generated/` (gitignored); the `*.labels.json` files are committed and a test checks they match the generator. Real royalty-free tracks can be added the same way. The sample songs use 100-140 bpm and 5-8 bar sections; a coarse 90 bpm / 4-bar variant failed because chords change faster than the 4 s novelty kernel, so it was replaced.
- M3 boundary metric (recall within 2 s over the synthetic set): v1 = 0.957 (22 of 23), recorded in `apps/server/tests/analysis/metrics.json`. A test fails if it drops below the recorded value.
- M3 tried a second pass that refines each peak with a 1.5 s kernel. It lowered recall (20/23), so it was removed.
- The analyzer returns `trackId = ""`; the caller sets it. `createdAt` is injectable so tests can compare output exactly.
- Python and TypeScript share types through JSON Schema: `pnpm --filter @grade/schema gen` writes `packages/schema/json/schema.json`, and the Python tests validate against it.
- M4 pyproject uses `yt-dlp>=...` and `uv.lock` holds the pin. An exact `==` pin made `make update-ytdlp` a no-op. The 2025.1.26 pin failed live ("page needs to be reloaded"); the lock now has 2026.8.19.
- M4 "max 2 concurrent jobs" means at most 2 jobs queued or running. A third new job gets `too_many_jobs` (HTTP 429). A repeat request for the same track returns the active job.
- M4 job state is in memory only. A server restart forgets job IDs. Stored tracks and analyses stay in SQLite.
- M4 a watch URL with both `v` and `list` is accepted as the single video. Only URLs with no video ID and a list are `playlist_not_supported`.
- M4 audio is kept as `play.m4a` (AAC 128k) and `analysis.wav` (mono 22.05 kHz) under `<data>/audio/<track>/`. The data folder defaults to `apps/server/data` (gitignored); `GRADE_DATA_DIR` changes it.
- M4 origin check on all `/api` routes: no `Origin` header, same host, or a value in `GRADE_ALLOWED_ORIGINS` passes. Anything else gets `forbidden`. There are no accounts, so this is the "same-origin-checked" option of section 6.3.
- M4 an analysis with an older `ANALYZER_VERSION` is not a cache hit. The job re-runs the analyzer on the stored WAV and skips the download.
- M4 upload limit is 200 MB (`bad_request`, HTTP 413). The `Range` header with several ranges or bad syntax is ignored and the full file is sent.
- M4 LRU eviction of stored audio (section 11) is not built. It stays open.
- M5 `PlaybackBackend` has one optional method, `scheduleJump(atReal, toReal, {glitch})`, on backends with `sampleAccurate`. Jumps apply in the order queued. `seek()` cancels them. This is how a cut lands on the audio clock without a timer.
- M5 `ClassRunner` keeps class time on an injected `Clock`. The backend position only corrects drift (limit 0.25 s with `scheduleJump`, 1 s without). Real positions cannot give class time, because a clip can repeat the same real range.
- M5 on a backend without `scheduleJump` the runner seeks at a genuine cut when its timer step runs (up to one 50 ms step late). After a long gap (background tab) it seeks once to the place that matches class time.
- M5 the crossfade is 20 ms, equal-power, at each genuine cut. The glitch grains are layered over the music and start 0.35 s before the cut.
- M5 `LocalAudioBackend` keeps the whole decoded song in memory. A 15-minute stereo 44.1 kHz song is about 300 MB as float32. This may fail on low-memory phones. Check on a device; the fix is to serve a 22.05 kHz mono copy for playback.
- M5 `capabilities.backgroundPlayback` is `false` for both backends. It is not measured. `docs/device-checklist.md` lists the manual items; none is tested yet.
- M5 wake lock is not in M5. M7 owns it (acceptance in section 9). `attachLifecycle` only calls `resync()` when the page becomes visible.
- M5 the runner pauses the backend when it notices the class end, up to one step (50 ms) after the last clip ends.
- M6 `ProgramPage` and `EditorStore` must not hold programs in deep `$state`. IndexedDB cannot clone Svelte proxies, so every save failed. The App flow test found this. Use `$state.raw` and `$state.snapshot`.
- M6 `OffsetBackend` (playback/) shifts a backend by `cropStart`. The editor wraps its backend with it, so segments and clips stay crop-relative and the stored audio stays in file time. M7 does the same for the runner.
- M6 routing is `location.hash` (`#/`, `#/import`, `#/analyzing/<job>/<track>`, `#/program/<id>`). No router library.
- M6 a program is saved 300 ms after the last change, and again when the editor closes. A failed save shows a banner and the editor keeps the unsaved state.
- M6 a drag (divider or tile edge) makes one history step, on release. Drag previews are local to the component.
- M6 importing a program file always gives it a new id, so it cannot replace an existing program. If the song is not in local storage, the app fetches it from the server; if the server lacks it, the user sees a message.
- M6 `audioBlobs` exists in the database schema but nothing writes to it. Audio comes from the server on each session.
- M6 the "listen" (microphone) import is not built. Appendix A.4 puts it after M7.
- M6 the layout was not looked at in a real browser (headless Firefox hangs here). jsdom tests cover behavior, not drawing or spacing. `src/api/live.test.ts` ran against the real server once and passed.
- M6 ESLint: `no-undef` is off for `.ts` and `.svelte` (TypeScript checks names). `.svelte.ts` files use the Svelte parser.
- M7 `LocalAudioBackend.load()` no longer starts a source. Call `seek()` before `play()`. A class plan shares one `AudioContext` between songs, and a source that started at load would play over the song that is playing. `dispose()` closes the context only when the backend owns it.
- M7 `PlanPlayer` (playback/plan.ts) plays the songs of a plan. It makes one runner and one backend for each song, loads the next song when 90 s of the current song remain, and drops the finished song. At most two decoded songs are in memory at once (about 600 MB for two 15-minute songs; see the M5 memory note).
- M7 the gap between songs is one `seek` and one `resume` of the audio context, not a measured value. The test uses a fake clock and shows under 1 s. If the next song has not loaded when the current one ends, the runner shows "Loading next song" and the gap is longer.
- M7 the Start tap calls `resume()` on the shared context before any `await`. Whether this is enough on iOS Safari is not tested (checklist item 6 and 10).
- M7 the wake lock (`ScreenWakeLock`) is requested in the Start tap and released when the user leaves or the class ends. It asks again when the page becomes visible. If the API is missing or refused, the runner shows a notice. It does not block the class.
- M7 the next-song button skips to the start of the next song. It ends the class on the last song. There is no previous-song button. Skip (+/- 10 s) stays inside the current song.
- M7 when the audio ends before the class part ends, `PlanPlayer` shows a notice and seeks to the place that class time shows. When the audio ends at the end of the class, it is not an error.
- M7 the mini waveform shows only. A tap on it does not seek, so a tap by mistake cannot jump the class.
- M7 the pulse is the energy at the current time, drawn as a soft light behind the text. It changes with `prefers-reduced-motion`: no transition.
- M7 the runner uses `--on-<tier>` text colors. In the dark theme, white text on the moderate tier had a contrast of 2.7:1, so easy, moderate and hard use dark text there. All four tiers pass 4.5:1 in both themes (light: 5.1 to 12.7; dark: easy, hard and moderate with dark text, all out with white text 5.3). This was calculated, not looked at on a screen.
- M7 the editor's "Start class" link saves first (`store.flush()`) and then opens the runner. Without it the runner could load the program before the 300 ms save ran.
- M7 new links that look like buttons use `<a class="button">`, not a button inside a link. Older links from M6 still nest a button in a link.
- M7 `Services` has `createContext`, `createWakeLock` and `clock`. Tests replace them with fakes.
- M7 glitch is off in the runner. The runner option exists, but no setting turns it on yet (M8 settings).
- M8 the app shows its own text for each API error code (`API_ERROR_TEXT`), not the server message. Reason: the text can say what to do next, and a test checks that every code in `ERROR_CODES` has one. An unknown code still shows the server message.
- M8 settings are `theme` (`system`, `light`, `dark`) and `glitch` (boolean) in the `settings` store. The theme is applied once storage opens, so there can be a short flash of the system theme.
- M8 the service worker caches the app shell only and skips `/api`, so audio and Range requests always reach the server. The icon is one SVG (no PNG), which some phones may not accept for a home-screen icon.
- M8 `audioBlobs` is still unused. Reason: a cache needs a size budget and eviction (section 11), and M8 acceptance in section 9 does not ask for it.
- After M8: the server serves `apps/web/dist` at `/` when `index.html` exists (`GRADE_WEB_DIR` changes the folder). The mount is last, so `/api` routes win. `Settings.web_dir` is `None` by default, and only `from_env` sets it, so tests do not depend on a local build.
- Phase 2.6A: `GRADE_MAX_ACTIVE_JOBS` is the single analysis-concurrency setting; it controls both worker count and the queued/running cap, defaults to 2, accepts 1 through 32, and invalid values stop startup rather than silently weakening deployment guardrails.
- Batch ingestion is a sequential CLI over `IngestService`; the existing complete-cache predicate is its restart checkpoint, so it preserves track IDs, analyzer versions, storage layout, and partial-failure recovery without a second pipeline.
- Source preparation uses yt-dlp's metadata-only `ytsearch`, writes an unapproved TSV with caution flags, and requires a separate validated approval/export step; source discovery can never start a download or silently choose a result.

# AI playlist planner

- The model extracts constraints only; deterministic server tools own selection and validation, preventing fabricated track IDs.
- Artist matching uses the stored title because the current track schema has no separate artist field.
- Playlist proposals are returned as song-based API data and do not alter the legacy block editor.
- Integration sprint: AI roles and explanations remain proposal-level metadata. Saving reuses an
  existing Program with the same canonical track ID and analysis version, or creates a neutral
  `programFromAnalysis` draft; it never overwrites instructor instructions or canonical analysis.
- Integration sprint: the planner repository opens SQLite read-only for every search, so a
  long-running server sees newly completed batch-ingestion rows without a restart or second catalog.
