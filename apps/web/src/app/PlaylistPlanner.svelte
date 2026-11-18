<script lang="ts">
  import { onMount } from 'svelte';
  import type { ClassPlan, Program } from '@grade/schema';
  import { formatTime } from '../editor/geometry';
  import { describeError } from './errors';
  import { hrefs } from './router';
  import type { Services } from './services';
  import {
    deterministicWorkoutInterpretation,
    planWorkout,
    type WorkoutPlanProposal,
  } from './workoutPlanner';

  interface Props {
    services: Services;
    onsaved: (id: string) => void;
  }
  let { services, onsaved }: Props = $props();
  let request = $state('');
  let programs: Program[] = $state.raw([]);
  let proposal = $state.raw<WorkoutPlanProposal | null>(null);
  let error = $state('');
  let loading = $state(true);
  let saving = $state(false);
  let planName = $state('Workout-aware class');

  onMount(async () => {
    try {
      programs = await services.storage.listPrograms();
    } catch (err) {
      error = describeError(err);
    } finally {
      loading = false;
    }
  });

  async function generate() {
    if (!request.trim()) return;
    loading = true;
    error = '';
    try {
      let interpretation;
      try {
        interpretation = await services.api.interpretWorkout(request);
      } catch {
        interpretation = deterministicWorkoutInterpretation(request);
      }
      proposal = planWorkout(programs, request, interpretation);
    } finally {
      loading = false;
    }
  }
  function move(index: number, by: number) {
    if (!proposal) return;
    const to = index + by;
    if (to < 0 || to >= proposal.entries.length) return;
    const entries = [...proposal.entries];
    [entries[index], entries[to]] = [entries[to]!, entries[index]!];
    proposal = { ...proposal, entries };
  }
  function remove(index: number) {
    if (proposal)
      proposal = { ...proposal, entries: proposal.entries.filter((_, i) => i !== index) };
  }
  async function save() {
    if (!proposal?.entries.length) return;
    saving = true;
    error = '';
    try {
      const current = new Map(
        (await services.storage.listPrograms()).map((program) => [program.id, program]),
      );
      if (proposal.entries.some((entry) => !current.has(entry.programId)))
        throw new Error(
          'A selected Program is no longer in this library. Generate the plan again.',
        );
      const plan: ClassPlan = {
        id: services.newId(),
        name: planName.trim() || 'Workout-aware class',
        programIds: proposal.entries.map((entry) => entry.programId),
      };
      await services.storage.saveClassPlan(plan);
      onsaved(plan.id);
    } catch (err) {
      error = describeError(err);
    } finally {
      saving = false;
    }
  }
</script>

<main>
  <a class="back" href={hrefs.library()}>&larr; Library</a>
  <span class="eyebrow">Instructor-program planner</span>
  <h1>Plan a class</h1>
  <p class="muted">
    Builds only from your existing, programmed rides. Program IDs, section boundaries, and every
    instructor cue stay unchanged.
  </p>
  {#if error}<div class="banner error" role="alert">{error}</div>{/if}
  <form
    onsubmit={(event) => {
      event.preventDefault();
      generate();
    }}
  >
    <label
      >Class request<textarea
        bind:value={request}
        rows="4"
        placeholder="Build a 30-minute cycling class with a warmup, two climbs, sprint intervals, and a cooldown."
      ></textarea></label
    >
    <button class="primary" type="submit" disabled={!request.trim() || loading}
      >{loading ? 'Reading library…' : 'Build from my Programs'}</button
    >
  </form>
  {#if proposal}
    <section aria-live="polite">
      <div class="heading">
        <div>
          <span class="eyebrow">{proposal.entries.length ? 'ready' : 'cannot match'}</span>
          <h2>{proposal.entries.length} existing Programs · {proposal.actualMinutes} minutes</h2>
        </div>
      </div>
      <p class="muted interpretation-mode">
        Planning: {proposal.mode === 'openai'
          ? `OpenAI interpretation (${proposal.model}) with deterministic Program selection`
          : 'deterministic local interpretation and workout scoring (no successful model call)'} · Library:
        {proposal.eligibleCount}
        instructor-authored eligible, {proposal.excludedCount} unprogrammed/AI draft excluded
      </p>
      {#if proposal.shortfalls.length}<div class="banner shortfall">
          <strong>Library limitations</strong>
          <ul>
            {#each proposal.shortfalls as shortfall (shortfall)}<li>{shortfall}</li>{/each}
          </ul>
        </div>{/if}
      <ol class="playlist">
        {#each proposal.entries as entry, index (entry.programId)}
          <li class="card">
            <div class="song">
              <span class="role">{entry.role}</span><strong>{entry.name}</strong><span class="muted"
                >{formatTime(entry.duration)} · Program ID {entry.programId}</span
              >
              <p>{entry.explanation}</p>
            </div>
            <div class="row controls">
              <button type="button" disabled={index === 0} onclick={() => move(index, -1)}
                >Up</button
              ><button
                type="button"
                disabled={index === proposal!.entries.length - 1}
                onclick={() => move(index, 1)}>Down</button
              ><button type="button" class="danger" onclick={() => remove(index)}>Remove</button>
            </div>
          </li>
        {/each}
      </ol>
      {#if proposal.entries.length}<div class="save card">
          <label>Class plan name<input bind:value={planName} /></label><button
            class="primary"
            type="button"
            onclick={save}
            disabled={saving}>{saving ? 'Saving…' : 'Save existing Programs as ClassPlan'}</button
          >
        </div>{/if}
    </section>
  {/if}
</main>

<style>
  h1 {
    font-size: clamp(3rem, 9vw, 6rem);
    margin: 8px 0 16px;
    letter-spacing: -0.06em;
  }
  h2 {
    margin: 4px 0;
  }
  .back {
    display: inline-block;
    margin-bottom: 36px;
  }
  form,
  label {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  form {
    align-items: flex-start;
    margin: 28px 0 44px;
  }
  textarea {
    width: min(100%, 720px);
    resize: vertical;
  }
  .heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 24px;
  }
  .shortfall {
    margin: 20px 0;
  }
  .playlist {
    list-style: none;
    padding: 0;
  }
  .playlist > li {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 12px;
  }
  .song {
    display: grid;
    gap: 5px;
  }
  .song p {
    margin: 6px 0 0;
  }
  .role {
    color: var(--pink);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .controls {
    justify-content: flex-end;
    align-self: center;
  }
  .save {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 20px;
    margin-top: 28px;
  }
  .save label {
    flex: 1;
  }
  @media (max-width: 700px) {
    .playlist > li,
    .save {
      align-items: stretch;
      flex-direction: column;
    }
    .controls {
      align-self: stretch;
    }
    .controls button {
      flex: 1;
    }
  }
</style>
