<script lang="ts">
  import { programFromAnalysis } from '@grade/core';
  import type { ClassPlan, PlaylistEntry, PlaylistProposal, Program } from '@grade/schema';
  import { formatTime } from '../editor/geometry';
  import { describeError } from './errors';
  import { hrefs } from './router';
  import type { Services } from './services';

  interface Props {
    services: Services;
    onsaved: (id: string) => void;
  }
  let { services, onsaved }: Props = $props();

  let request = $state('');
  let proposal = $state.raw<PlaylistProposal | null>(null);
  let error = $state('');
  let working = $state(false);
  let saving = $state(false);
  let planName = $state('AI playlist');

  function normalized(current: PlaylistProposal): PlaylistProposal {
    return {
      ...current,
      entries: current.entries.map((entry, index) => ({ ...entry, position: index + 1 })),
    };
  }

  async function generate(text = request) {
    if (!text.trim()) return;
    working = true;
    error = '';
    try {
      proposal = await services.api.planPlaylist(text, proposal ? normalized(proposal) : undefined);
      request = '';
    } catch (err) {
      error = describeError(err);
    } finally {
      working = false;
    }
  }

  function move(index: number, by: number) {
    if (!proposal) return;
    const to = index + by;
    if (to < 0 || to >= proposal.entries.length) return;
    const entries = [...proposal.entries];
    [entries[index], entries[to]] = [entries[to]!, entries[index]!];
    proposal = normalized({ ...proposal, entries });
  }

  function remove(index: number) {
    if (!proposal) return;
    proposal = normalized({ ...proposal, entries: proposal.entries.filter((_, i) => i !== index) });
  }

  async function replace(index: number) {
    await generate(`Replace the ${index + 1} playlist entry.`);
  }

  async function programFor(entry: PlaylistEntry, existing: Program[]): Promise<Program> {
    const [track, analysis] = await Promise.all([
      services.api.getTrack(entry.track_id),
      services.api.getAnalysis(entry.track_id),
    ]);
    await services.storage.saveTrack(track);
    await services.storage.saveAnalysis(analysis);
    const reusable = existing.find(
      (program) =>
        program.trackId === entry.track_id && program.analysisVersion === analysis.version,
    );
    if (reusable) return reusable;
    const program = programFromAnalysis(
      analysis,
      { name: `${track.title} — AI draft`, now: services.now() },
      { newId: services.newId },
    );
    await services.storage.saveProgram(program);
    existing.push(program);
    return program;
  }

  async function save() {
    if (!proposal?.entries.length) return;
    saving = true;
    error = '';
    try {
      const existing = await services.storage.listPrograms();
      const programIds: string[] = [];
      for (const entry of proposal.entries) {
        programIds.push((await programFor(entry, existing)).id);
      }
      const plan: ClassPlan = {
        id: services.newId(),
        name: planName.trim() || 'AI playlist',
        programIds,
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
  <span class="eyebrow">Catalog-grounded planning</span>
  <h1>Plan with AI</h1>
  <p class="muted">
    Describe the class you want. GRADE selects only analyzed songs in the server catalog; you remain
    in control of the order and the detailed ride instructions.
  </p>

  {#if error}<div class="banner error" role="alert">{error}</div>{/if}

  <form
    onsubmit={(event) => {
      event.preventDefault();
      void generate();
    }}
  >
    <label>
      Playlist request or revision
      <textarea
        bind:value={request}
        rows="4"
        placeholder="Make me a 10-song Rihanna class with five hills, four sprints, and one surprise."
      ></textarea>
    </label>
    <button class="primary" type="submit" disabled={!request.trim() || working}>
      {working ? 'Planning…' : proposal ? 'Revise playlist' : 'Generate playlist'}
    </button>
  </form>

  {#if proposal}
    <section aria-live="polite">
      <div class="heading">
        <div>
          <span class="eyebrow">{proposal.status}</span>
          <h2>{proposal.summary}</h2>
        </div>
        <strong
          >{formatTime(proposal.entries.reduce((sum, entry) => sum + entry.duration, 0))}</strong
        >
      </div>

      {#if proposal.shortfalls.length}
        <div class="banner shortfall">
          <strong>The catalog cannot fully satisfy this request.</strong>
          <ul>
            {#each proposal.shortfalls as shortfall (shortfall)}<li>{shortfall}</li>{/each}
          </ul>
        </div>
      {/if}

      <ol class="playlist">
        {#each proposal.entries as entry, index (entry.track_id)}
          <li class="card">
            <div class="song">
              <span class="role">{entry.purpose}</span>
              <strong>{entry.title}</strong>
              <span class="muted">
                {entry.bpm ? `${Math.round(entry.bpm)} BPM · ` : ''}{formatTime(entry.duration)}
              </span>
              <p>{entry.explanation}</p>
            </div>
            <div class="row controls">
              <button
                type="button"
                aria-label={`Move ${entry.title} up`}
                disabled={index === 0}
                onclick={() => move(index, -1)}>Up</button
              >
              <button
                type="button"
                aria-label={`Move ${entry.title} down`}
                disabled={index === proposal!.entries.length - 1}
                onclick={() => move(index, 1)}>Down</button
              >
              <button type="button" onclick={() => replace(index)} disabled={working}
                >Replace</button
              >
              <button type="button" class="danger" onclick={() => remove(index)}>Remove</button>
            </div>
          </li>
        {/each}
      </ol>

      {#if proposal.entries.length}
        <div class="save card">
          <label>
            Class plan name
            <input bind:value={planName} />
          </label>
          <button class="primary" type="button" onclick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save as class plan'}
          </button>
        </div>
      {/if}
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
  .shortfall ul {
    margin-bottom: 0;
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
