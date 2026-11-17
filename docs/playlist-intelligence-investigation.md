# Playlist intelligence investigation

## Runtime and root causes

The API chooses `OpenAIRequestInterpreter` only when `OPENAI_API_KEY` is present in the server
process. Otherwise it chooses `RuleBasedRequestInterpreter`. If an OpenAI request raises for any
reason, interpretation silently falls back to the same deterministic rules. The model extracts
constraints only; catalog search, scoring, ordering, validation, and track IDs are always local and
deterministic.

For this investigation, `.env.local` contains a non-empty key, but the investigation process did
not have `OPENAI_API_KEY` exported. Tests therefore exercised deterministic interpretation and did
not make an OpenAI request. A key existing in a file is not sufficient: the documented server
startup must export it into the process.

Confirmed defects:

- With no count, duration, or requested role count, `_create` used `len(candidates)` as its target,
  so a vague request returned the entire 47-song catalog.
- Selection repeatedly chose the maximum score and used track ID as a fixed tie-breaker. A smaller
  request was therefore a prefix of a larger request using the same constraints.
- The revision schema represented only a position/role replacement. It could not represent
  `Replace Hardware Store with Breakin' Dishes`.
- The rule-based artist parser recognized only a narrow `make/build/create ... artist ... playlist`
  shape. It missed common `songs by`, `playlist from`, and `give me` forms. Catalog artist matching
  is still based on the stored title because there is no canonical artist column.
- When requested role counts exceeded an explicit song count, role counts silently enlarged the
  playlist and violated the explicit total.

## Implemented behavior

- Vague requests default to at most 10 catalog tracks.
- When the client supplies a prior proposal, new selection prioritizes unused tracks before score.
  This gives controlled variety without randomness: the same request plus the same prior proposal
  always yields the same result. If the catalog is too small, prior tracks remain eligible so the
  planner can still satisfy the requested count.
- Explicit resize language such as `Make this a 15-song playlist` preserves the existing ordered
  tracks and deterministically appends unused catalog tracks (or truncates for a smaller size).
- Named replacement resolves both the source and replacement by a normalized exact title or the
  exact title after an `Artist - ` prefix. Ambiguous, absent, or already-used replacements produce
  a shortfall instead of inventing or duplicating a track.
- Common artist request phrasings are parsed consistently in deterministic fallback mode.
- Explicit song count remains authoritative when constraints conflict; unmet role counts are
  reported by existing validation.
- Every selected ID is still validated against the read-only catalog, and shortages remain visible
  in `shortfalls`.

## Smallest compatible workout-format design

The current shared `Analysis` owns audio facts (energy, BPM, beats, boundaries, structure). A
`Program` is the instructor-editable version for one track and analysis version (segments, clips,
labels, tiers). Multiple Programs can already point to the same `trackId`, so workout purpose belongs
on `Program`, not `Analysis` or `Track`.

Proposed optional Program field:

```ts
type WorkoutFormat =
  | 'heavy-climb'
  | 'rolling-hills'
  | 'sprint-intervals'
  | 'endurance'
  | 'recovery'
  | 'mixed-intervals';

interface ProgramWorkoutMetadata {
  primaryFormat?: WorkoutFormat;
  tags?: string[];
  suggestion?: {
    primaryFormat?: WorkoutFormat;
    tags: string[];
    basedOnInstructionsHash: string;
    generatedAt: string;
    model: string;
  };
  primaryFormatSource?: 'instructor' | 'accepted-suggestion';
}

interface Program {
  // existing fields unchanged
  workout?: ProgramWorkoutMetadata;
}
```

`primaryFormat` and `tags` are instructor-owned accepted values. An AI suggestion stays separate and
never overwrites them. Regeneration can replace only `suggestion`; accepting a suggestion copies the
chosen values into the instructor-owned fields and records their source. A later manual edit changes
the accepted values without being overwritten. The instruction hash makes stale suggestions
detectable after programming instructions change.

Movement, cadence, exertion, zone, segment tier, and workout format remain distinct fields/concepts.
Audio energy may help rank a track after a Program format matches, but must not create or overwrite
the format. Suggestions should be derived from instructor-authored programming instructions only.

Before implementation, define the controlled primary enum with instructors and decide whether
free-form tags need normalization. Then add the optional field to the TypeScript/Zod schema and
editor/storage round-trip tests. Because older builds strip unknown Zod object keys on import, a
schema-version/capability guard is safer than assuming old clients preserve the new field. No
existing Program should be classified automatically.

## Planner use of workout metadata

The planner should search programming versions, not just tracks. It should:

1. Filter/rank Programs by accepted `primaryFormat` and tags when the request names a workout
   purpose.
2. Deduplicate final results by `trackId`, selecting the best matching Program version for each song.
3. Treat AI suggestions as lower-confidence candidates unless accepted by an instructor.
4. Use BPM/energy only as secondary musical-fit signals, never as a substitute for format metadata.
5. Return the selected `programId` with `trackId` so saving a class preserves the intended instructor
   programming version instead of selecting an arbitrary Program for that audio.
6. Explain when too few accepted Programs satisfy the requested format and whether suggestions were
   used to broaden the result.

## Remaining limitations

- Artist is still inferred by substring matching against a title; the catalog needs structured
  artist metadata for authoritative filtering.
- Controlled variation depends on the client returning the prior proposal. Independent stateless
  requests with identical input remain identical by design.
- Named title matching intentionally rejects ambiguity and does not yet use aliases.
- OpenAI failures fall back silently; a future API diagnostic field or structured server event should
  expose `openai` versus `deterministic-fallback` without exposing credentials.
- Duration planning estimates a count from average duration and does not solve an exact subset-sum
  optimization.
