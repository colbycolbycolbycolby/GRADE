# GRADE Rewrite: Architecture and Build Plan

Status: Draft v0.4, written to be handed to a coding agent. Read sections 0-2 first, then work milestone by milestone (section 9).

## 0. How to use this document (agent instructions)

- Treat this file as the source of truth. If code and this file disagree, stop and flag it; do not silently pick one.
- Work **one milestone at a time** (section 9). Each milestone has acceptance criteria and verification commands. Do not start the next milestone until the current one passes.
- Commit at the end of each milestone with a message naming the milestone.
- Prefer small, typed, pure functions with unit tests. No module-level mutable state in the core model.
- Do **not** expand scope. Anything under "Non-goals" (section 1) or "Later" (section 10) is out of scope unless the user asks.
- **Defaults**: where a decision is marked `DEFAULT`, assume it unless the user overrides it. Where marked `ASK`, stop and ask before building anything that depends on it.
- If something is ambiguous and not covered here, make the simplest choice, write it down in `docs/decisions.md` (one line: decision, reason), and continue.
- Legacy reference: `GRADE_ridebuilder_for_chat.html` is the existing single-file prototype. Port its behavior using the mapping and constants in Appendix A. Do not copy its architecture (globals, DOM-driven state).

## 1. Product

A tool for indoor cycling instructors. Input: a song (local audio file or YouTube link). Output: an editable **ride program**, a timeline of effort blocks (Easy / Moderate / Hard / All Out) aligned to the song's real structure. The instructor reorders, repeats, trims, and relabels blocks, then runs the program as a full-screen class display with a countdown and "coming up" queue while the music plays.

Core idea: "build the climb into the song." Effort follows the music's structure.

### Users and context
- Instructors using a phone or tablet in a studio, often with the screen locked or glanced at from a bike. Reliability during a 45-minute class matters more than polish.
- This is a school group project. Not a public release.

### Non-goals
- Bike/power-meter integration, leaderboards, accounts, social features.
- Apple Music / Spotify analysis (neither exposes audio; Spotify removed audio analysis for new apps in Nov 2024).
- Sharing or redistributing audio outside the project's own users.

## 2. Decisions

| # | Decision | Status | Value |
|---|---|---|---|
| D1 | Analysis location | DEFAULT | Server-side Python for all inputs (files and YouTube) |
| D2 | Client stack | DEFAULT | TypeScript, Vite, Svelte 5, Vitest, Dexie, PWA |
| D3 | Server stack | DEFAULT | Python 3.11+, FastAPI, yt-dlp, ffmpeg, librosa (Essentia optional), SQLite, in-process job worker |
| D4 | YouTube extraction | DECIDED | Use yt-dlp server-side. User has accepted the ToS tradeoff for this school project |
| D5 | Downloaded audio | DECIDED | **Keep it** (compressed original + analysis WAV), keyed by video ID; storage must not be publicly accessible |
| D6 | YouTube playback | DEFAULT | Stream stored audio to the client and play via Web Audio; YouTube IFrame embed is a fallback backend |
| D7 | Track identity | DEFAULT | File: SHA-256 content hash. YouTube: video ID. Manual "link" between a file and a video via an alias table. No fingerprinting in v1 |
| D8 | Deployment | DEFAULT | Run locally / on a campus or home machine first. Cloud IPs may be blocked by YouTube; do not assume cloud works |
| D9 | Repo layout | DEFAULT | Monorepo, see section 4 |

If the user changes D1, only the `Analyzer` implementation location changes; the interface in section 6.2 stays the same.

## 3. Architecture overview

```
Client (PWA)
  UI screens -> app stores (editing, class runner)
        |                        |
  core/ (pure TS)          playback/ (backend interface)
        |                   |-- LocalAudioBackend  (Web Audio, default)
  api client                |-- YouTubeEmbedBackend (fallback)
        |
  storage/ (IndexedDB)

Server
  FastAPI -> job queue -> AudioIngest (yt-dlp + ffmpeg) -> Analyzer (Python) -> analysis cache + audio store (SQLite + disk)
```

Rules for layer boundaries:
- `core/` imports nothing from UI, storage, playback, or network.
- UI never touches audio elements or timers directly; it subscribes to events from the class runner.
- The server never sends raw analysis internals the client can't type; all payloads match the JSON schemas in `packages/schema`.

## 4. Repository layout

```
/ (monorepo)
  apps/
    web/            # Svelte PWA
    server/         # FastAPI service
  packages/
    core/           # pure TS: model + editing operations + class runner schedule
    schema/         # shared types + JSON Schema/zod for Analysis, Program, API payloads
  docs/
    decisions.md    # running log of small decisions
  legacy/
    GRADE_ridebuilder_for_chat.html
  architecture.md   # this file
```

## 5. Data model (authoritative)

```ts
type Tier = 'easy' | 'moderate' | 'hard' | 'allout';

interface Track {
  id: string;                         // fileHash or youtube videoId, prefixed: "file:<sha256>" | "yt:<videoId>"
  source: 'file' | 'youtube' | 'mic';
  title: string;
  duration: number;                   // seconds
  aliases: string[];                  // other track ids known to be the same song
}

interface Analysis {                  // immutable once computed
  trackId: string;
  version: number;                    // analyzer version, bump when output meaning changes
  duration: number;
  energy: { t: number; e: number }[]; // e normalized 0..1, ~10 Hz
  bpm?: number;
  beats?: number[];                   // seconds
  downbeats?: number[];               // seconds, bar starts if detected
  boundaries: number[];               // seconds, suggested section starts (excluding 0 and duration)
  cropStart: number; cropEnd: number; // auto silence trim, seconds in original time
  createdAt: string;
}

interface Segment {                   // the song's real chronological structure
  id: string;
  start: number; end: number;         // crop-relative seconds, contiguous, cover [0, duration]
  tier: Tier;
  label: string | null;               // null => UI shows "Section N" computed from position
  kind: 'intro' | 'outro' | 'section';
  similarTo?: string;                 // segment id of the earliest section it sounds like
}

interface Clip {                      // one entry in class order
  id: string;
  segmentId: string;
  start: number; end: number;         // trim window within the segment (real time)
}

interface Program {
  id: string; name: string;
  trackId: string; analysisVersion: number;
  segments: Segment[];                // chronological
  clips: Clip[];                      // class order
  updatedAt: string;
}

interface ClassPlan { id: string; name: string; programIds: string[]; }
```

Invariants (enforce with tests):
1. `segments` are sorted, contiguous, non-overlapping, first starts at 0, last ends at duration; each at least `MIN_SEGMENT_SEC` long.
2. Every clip references an existing segment; `segment.start <= clip.start < clip.end <= segment.end`; clip length at least `MIN_CLIP_SEC`.
3. `clips` is never empty.
4. Structural edits (split, merge, delete, boundary move) must **repair** clips deliberately: remap, clamp, or drop clips of affected segments, and report what changed. The legacy app reset class order to chronological on any structural edit; keep that as the fallback only if repair is impossible, and tell the user.
5. Segment titles are derived at render time: `label ?? "Section N"` where N is the 1-based position among `kind === 'section'` segments. Never store the generated number in `label`.

Constants: `MIN_SEGMENT_SEC = 2`, `MIN_CLIP_SEC = 1`.

## 6. Components

### 6.1 `packages/core` (pure TypeScript)
Functions (all pure, return new values, throw typed errors for invalid input):
- `splitSegment(program, segmentId, at)`, `mergeIntoPrevious(program, segmentId)`, `deleteSegment`, `moveBoundary(program, index, to)`
- `reorderClips(program, fromIndices, toIndex)` (supports multi-select group move)
- `duplicateClips`, `removeClips` (refuse to empty the order), `trimClip(program, clipId, start, end)`
- `generateIntervals(program, fromTime, onSec, offSec, label?)` (alternating all-out/easy to the end)
- `setTier`, `setLabel`
- `buildSchedule(program)`: flattens clips into `ScheduleItem[]` with `{ clipId, segmentId, tier, title, realStart, realEnd, classStart, classEnd }`. The class timeline is the concatenation of clips.
- `serializeProgram` / `parseProgram` with schema validation and a `schemaVersion`
- Undo/redo: command history over `Program` snapshots (new feature, simple immutable stack).

### 6.2 Analysis (server, `apps/server/analysis/`)

Interface (Python protocol, mirrored by the `Analysis` schema):
```python
class Analyzer(Protocol):
    def analyze(self, wav_path: str, progress: Callable[[float], None] | None = None) -> Analysis: ...
```
Pipeline (port from legacy; constants in Appendix A):
1. Decode to mono float, resample (for example 22.05 kHz).
2. Energy curve: RMS, smoothing, normalize to 0..1, about 10 points/sec.
3. Beat and tempo tracking (new): BPM, beats, downbeats if available.
4. Features per window: chroma (12 bins) plus coarse low/mid/high texture.
5. Novelty curve: compare mean features before vs. after each point (4 s kernel), blended with energy change; pick peaks at least 8 s apart above `mean + 0.6*std`.
6. Snap boundaries to the nearest downbeat/beat within a tolerance (new).
7. Cluster whole segments by similarity (feature vector plus weighted average energy); merge segments under 6 s into neighbors.
8. Mark leading/trailing short unrepeated segments as intro/outro.
9. Assign each segment's tier from its own average energy using thresholds `[0.28, 0.44, 0.62]`.
10. Auto crop leading/trailing silence (energy below 0.05 for at least 1 s); keep at least 10 s.
11. Fallback if structure detection yields fewer than 2 segments: segment by energy tier and merge segments under 12 s.

Output must be deterministic for the same input and analyzer version.

### 6.3 Ingest (server, `apps/server/ingest/`)
```python
class AudioIngest(Protocol):
    def resolve(self, url: str) -> TrackMeta: ...            # id, title, duration; no download
    def fetch_audio(self, track_id: str) -> StoredAudio: ... # returns stored copy if present
```
`YtDlpIngest` flow:
1. Normalize URL to video ID; reject non-YouTube hosts and playlists (v1: single videos only).
2. Check cache: analysis exists and audio stored => return immediately.
3. Enforce limits: max duration 15 min, max 2 concurrent jobs, one job per video ID at a time.
4. yt-dlp downloads best audio; ffmpeg produces (a) a compressed copy for playback (for example AAC/Opus) and (b) a mono WAV for analysis.
5. Run `Analyzer`, report progress, persist analysis and file paths, write job result.
6. Store audio under a non-web-served directory; serve it only through an authenticated or same-origin-checked endpoint with `Range` support.

Operational requirements: pin the yt-dlp version in the lockfile; provide `make update-ytdlp`; map known yt-dlp failures (unavailable, age-restricted, blocked) to specific, user-readable error codes. Never retry endlessly.

### 6.4 API (`apps/server/api/`)
```
POST /api/ingest/youtube   { url }                      -> { jobId, trackId }
POST /api/ingest/file      multipart audio              -> { jobId, trackId }
GET  /api/jobs/{jobId}     -> { status: queued|running|done|error, progress: 0..1, error?: {code,message}, trackId }
GET  /api/tracks/{trackId} -> Track
GET  /api/tracks/{trackId}/analysis -> Analysis
GET  /api/tracks/{trackId}/audio    -> audio stream (Range supported)
```
All request/response bodies validated against `packages/schema`. Error shape: `{ code: string, message: string }`.

### 6.5 Playback engine (`apps/web/src/playback/`)
```ts
interface PlaybackBackend {
  load(track: { id: string; url?: string; youtubeId?: string }): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): Promise<void>;
  readonly position: number;                 // seconds, best effort
  onPosition(cb: (t: number) => void): () => void;
  onEnded(cb: () => void): () => void;
  capabilities: { sampleAccurate: boolean; crossfade: boolean; backgroundPlayback: boolean };
  dispose(): void;
}
```
- `LocalAudioBackend`: decode with Web Audio; schedule clip playback against `AudioContext.currentTime` so cuts are sample-accurate. Implement short equal-power crossfades at non-contiguous cuts. Port the legacy "transition glitch" as an optional effect (Appendix A). Resume the `AudioContext` inside the user gesture that starts class.
- `YouTubeEmbedBackend` (fallback): IFrame API, `seekTo`, position from `getCurrentTime`. Capabilities all false; UI must warn and disable glitch/crossfade.
- `ClassRunner` (in `core` for the schedule, in `web` for the timing glue) drives `play/seek` from `buildSchedule()` and emits `blockChanged`, `tick`, `classEnded`. UI subscribes; it never reads the audio element.
- Keep the screen awake with the Wake Lock API during class. Handle `visibilitychange` and audio interruptions; on resume, re-sync position to the schedule.

### 6.6 Storage (client, `apps/web/src/storage/`)
IndexedDB via Dexie, versioned schema with migrations from version 1. Stores: `tracks`, `analyses`, `programs`, `classPlans`, `audioBlobs` (optional cache of stored audio), `settings`. Analysis is stored once per track; programs reference it by `trackId`. Provide JSON export/import of a Program (validated).

### 6.7 UI (`apps/web/src/ui/`)
Screens: Library, Import (file / YouTube link / listen), Analyzing (job progress), Program editor, Class runner, Class plan, Settings.

Editor requirements (ported from legacy, with improvements):
- Waveform colored by tier; tap to select a segment; drag divider lines to resize; playhead; scrub bar.
- Section numbers drawn in a row **below** the waveform, never over it.
- Tier picker for the selected segment.
- Class-order strip: drag to reorder, drag tile edges to trim, corner checkbox for multi-select (group move/duplicate/remove), drop zones for duplicate and remove.
- Block list in class order with per-block intensity, rename (with autocomplete from labels already used), split, merge, delete, repeat, remove-from-order.
- Interval generator from the playhead (defaults 20 s on / 20 s off).
- Undo/redo.
Class runner: full-screen, background color = current tier color; cue text (Ease up / Building / Push / All out), block title, large countdown, "coming up" queue (next 3), -10 s / +10 s, play/pause, next-song button in a class plan; mini waveform of the *class order* with playhead; background pulse driven by energy at the current time.

Accessibility and robustness: large tap targets, readable contrast in both themes, dark mode setting, no reliance on color alone (tier text label shown).

## 7. Testing strategy
- `packages/core`: unit tests for every operation and every invariant in section 5; property-style tests for random edit sequences (invariants always hold, repair never loses the last clip).
- Analysis: a reference set of 5-10 short royalty-free tracks under `apps/server/tests/fixtures/` with hand-labeled boundaries (`*.labels.json`). Metric: fraction of labeled boundaries within 2 s of a detected boundary; record it per analyzer version and do not let it regress without a note in `docs/decisions.md`.
- Ingest: tests with yt-dlp mocked; one opt-in live test (`pytest -m live`) that is skipped by default.
- API: contract tests against the schema.
- Web: component tests for editor operations; one end-to-end smoke test (import fixture file, edit, start class, advance schedule with a fake backend).
- Manual device checklist in `docs/device-checklist.md`: 45-minute class with screen locked, incoming call/interruption, switching apps and returning, Bluetooth speaker connect/disconnect, low-power mode.

## 8. Conventions
- TypeScript `strict: true`; no `any` without a comment. Python typed, checked with `mypy` or `pyright`.
- Formatting: Prettier + ESLint (web, core), Ruff (server). Run on commit.
- IDs: `crypto.randomUUID()` on the client; track IDs as defined in section 5.
- Times: seconds as floats; crop-relative for segments and clips, original-file time only inside `Analysis`.
- No network calls from `packages/core`. No global singletons for state.
- Secrets/config via environment variables; document in `README.md`.

## 9. Milestones

Each milestone ends with a passing test run and a commit.

**M1: Foundation.**
Create the monorepo (section 4), tooling, lint/format, test runners, CI script.
Acceptance: `pnpm install && pnpm test` and `cd apps/server && pytest` both run (even if tests are trivial); lint passes.

**M2: Schema and core model.**
Implement `packages/schema` and `packages/core` operations, invariants, serialization, schedule builder, undo/redo.
Acceptance: all section 5 invariants have tests; random edit-sequence test passes; `buildSchedule` output matches hand-computed expectations for three fixture programs.

**M3: Analysis service.**
Port the pipeline (6.2) to Python with beat tracking and boundary snapping; add the fixture set and the boundary metric.
Acceptance: `pytest apps/server/tests/analysis` passes; deterministic output for repeated runs; boundary metric recorded; fallback segmentation path is tested.

**M4: Ingest and API.**
Implement `AudioIngest`, job queue, cache, audio store, endpoints (6.3, 6.4).
Acceptance: with yt-dlp mocked, the full job flow works; limits enforced; repeat requests hit the cache; audio endpoint supports `Range`; one live test (opt-in) works from the target machine.

**M5: Playback engine.**
Implement `LocalAudioBackend` with sample-accurate scheduling, crossfade, optional glitch; `ClassRunner` glue; then `YouTubeEmbedBackend`.
Acceptance: a headless/fake-clock test shows cues fire at the scheduled times; manual device checklist passes the screen-lock and interruption items; capability flags are correct for each backend.

**M6: Client app.**
Storage layer, API client, Import flow with job progress, Library, and Program editor.
Acceptance: user can import a fixture file and a (mocked or live) YouTube link, edit blocks via all operations in 6.7, save, reload, and export/import a program. Component tests pass.

**M7: Class runner and class plans.**
Full-screen runner (6.7), multi-song class plans with auto-advance and skip.
Acceptance: end-to-end smoke test passes; a 3-song plan advances automatically with no gap longer than 1 s on the local backend; wake lock requested on start and released on exit.

**M8: Polish and docs.**
README (setup, run, update yt-dlp), `docs/device-checklist.md`, dark mode, error states for every API error code.
Acceptance: fresh clone to running app using only the README; all device checklist items recorded as passed or known issues.

## 10. Later (out of scope until asked)
Streaming-service playback backends (MusicKit, Spotify App Remote); cadence/BPM targets in the runner; sharing programs between users; shared structure database; fingerprint-based identity matching; in-browser analysis fallback; native wrapper (Capacitor).

## 11. Risks (read before M4 and M5)
- **yt-dlp fragility**: breaks when YouTube changes; datacenter IPs are often challenged. Mitigation: pin and update, isolate behind `AudioIngest`, deploy where it works, clear error codes.
- **Terms/copyright**: YouTube extraction is outside YouTube's terms as understood; accepted for this school project. Retained audio must stay private (no public URLs, no sharing). Revisit before any public release.
- **Mobile background audio** in a PWA is the biggest technical unknown; test on real phones in M5 and report findings in `docs/decisions.md`. If it fails, propose a Capacitor wrapper rather than working around it silently.
- **Structure accuracy** is heuristic; the editor is the safety net. Track the boundary metric per analyzer version.
- **Storage growth** from retained audio: add a size budget and least-recently-used eviction (M4 or later).

## Appendix A: Legacy behavior reference

Source: `legacy/GRADE_ridebuilder_for_chat.html`. Preserve behavior and constants unless a milestone says otherwise.

### A.1 Constants
| Area | Constant |
|---|---|
| Energy | frame 0.25 s, hop 0.1 s, moving average over 12 frames, min-max normalize to 0..1 |
| Features | window and hop 0.5 s; chroma over octaves 3-5 (12 pitch classes); texture bands about 200 / 800 / 3000 Hz |
| Feature vector | normalized chroma plus normalized texture scaled by 0.6 |
| Novelty | kernel 4 s each side; novelty = 0.75 * (1 - cosine similarity) + 0.25 * abs(energy change) |
| Peak picking | threshold mean + 0.6 * std of positive novelty; minimum spacing 8 s |
| Clustering | segment similarity threshold 0.88 (cosine); energy appended to the feature vector with weight 1.8 |
| Short segments | merge segments under 6 s (structure path), under 12 s (fallback path) |
| Intro/Outro | first/last segment shorter than max(25 s, 15% of duration) and not part of a repeat group |
| Tier thresholds | energy > 0.62 all out; > 0.44 hard; > 0.28 moderate; else easy |
| Silence trim | energy below 0.05 for at least 1 s at either end; keep at least 10 s |
| Min block | 2 s (editing), clip trim minimum 1 s |
| Genuine cut | next clip start differs from current clip end by more than 0.05 s |

### A.2 Naming
Sections are numbered by chronological position ("Section 1, 2, ..."), not by guessed musical role. Sections that sound like an earlier one show a subtle "~N" hint pointing to the first similar section. Intro and Outro are positional and unnumbered.

### A.3 Transition glitch (optional effect, `LocalAudioBackend` only)
Fires before a genuine cut when enabled: look ahead 0.35 s; take a 0.14 s grain from just before the cut point in the real audio; repeat it 6 times; each repeat's spacing is `grain * max(0.55, 0.92 - 0.05*i)`; gain per repeat peaks at `max(0.35, 0.95 - 0.10*i)` with a 8 ms attack and linear decay to 0. Resume the audio context inside the Start Class gesture or the effect may be silent.

### A.4 Live listening (mic) mode
Records microphone audio, shows a rolling 20 s energy chart, and every 0.5 s computes chroma and compares against earlier frames at least 8 s old; if cosine similarity exceeds 0.88, show "This might be a repeat of M:SS". On finish, run the normal analysis pipeline on the recording. In the rewrite this is a secondary input; implement after M7 unless the user asks earlier.

### A.5 Known legacy bugs and their fixes (do not reintroduce)
- Storage silently did nothing because `window.storage` was never defined; use IndexedDB with explicit error handling.
- Chart section numbers drawn on the canvas were hidden by tall energy peaks; draw them below the plot.
- Chroma frame times are raw-file time but segments are crop-relative; convert explicitly (this caused boundaries about `cropStart` seconds late).
- Duplicate default titles after split/add-break because `label` was copied; never store generated titles.
- Playlist advance could stall when the browser's native `ended` fired before the polling loop noticed; handle `ended` explicitly in addition to scheduled advance.
- Blend-mode blobs bled through the class overlay; isolate the stacking context of the full-screen runner (`isolation: isolate`).
- Setting `currentTime` at every block boundary caused stutter; only seek on genuine (non-contiguous) cuts.
