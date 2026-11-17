<script lang="ts">
  import { onMount } from 'svelte';
  import type { ClassPlan, Program } from '@grade/schema';
  import { formatTime } from '../editor/geometry';
  import { describeError } from './errors';
  import { classSeconds, importProgramText } from './programFiles';
  import { hrefs } from './router';
  import type { Services } from './services';

  interface Props {
    services: Services;
    onopen: (id: string) => void;
  }
  let { services, onopen }: Props = $props();

  let programs: Program[] = $state([]);
  let plans: ClassPlan[] = $state([]);
  let titles: Record<string, string> = $state({});
  let loading = $state(true);
  let error = $state('');
  let confirming: string | null = $state(null);

  async function load() {
    try {
      programs = await services.storage.listPrograms();
      plans = await services.storage.listClassPlans();
      const entries = await Promise.all(
        [...new Set(programs.map((p) => p.trackId))].map(
          async (id) =>
            [id, (await services.storage.getTrack(id))?.title ?? 'Unknown song'] as const,
        ),
      );
      titles = Object.fromEntries(entries);
    } catch (err) {
      error = describeError(err);
    } finally {
      loading = false;
    }
  }
  onMount(load);

  async function remove(id: string) {
    if (confirming !== id) {
      confirming = id;
      return;
    }
    confirming = null;
    try {
      await services.storage.deleteProgram(id);
      programs = programs.filter((p) => p.id !== id);
    } catch (err) {
      error = describeError(err);
    }
  }

  async function newPlan() {
    const plan: ClassPlan = { id: services.newId(), name: 'New class plan', programIds: [] };
    try {
      await services.storage.saveClassPlan(plan);
      location.hash = hrefs.plan(plan.id);
    } catch (err) {
      error = describeError(err);
    }
  }

  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    error = '';
    try {
      const program = await importProgramText(services, await file.text());
      onopen(program.id);
    } catch (err) {
      error = describeError(err);
    }
  }
</script>

<main>
  <header class="hero">
    <div class="brand-lockup">
      <span class="eyebrow">Ride design studio</span>
      <h1>GR<span>A</span>DE</h1>
      <p>Shape the music. Build the energy. Lead the room.</p>
    </div>
    <div class="energy-mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
    <div class="row hero-actions">
      <a href={hrefs.import()}><button type="button" class="primary">New program</button></a>
      <a class="button" href={hrefs.planner()}>Plan with AI</a>
      <label class="file">
        <span class="button">Import program file</span>
        <input type="file" accept=".json,application/json" onchange={importFile} />
      </label>
      <a class="button quiet" href={hrefs.settings()}>Settings</a>
    </div>
  </header>

  {#if error}<div class="banner error" role="alert">{error}</div>{/if}

  {#if loading}
    <p class="muted">Loading&hellip;</p>
  {:else if programs.length === 0 && !error}
    <div class="empty-state">
      <span class="eyebrow">Your first climb starts here</span>
      <h2>Turn a song into a ride.</h2>
      <p class="muted">Add a track and GRADE will map its energy into editable sections.</p>
      <p class="muted legacy-copy">No programs yet. Make one from a song.</p>
      <a class="button primary" href={hrefs.import()}>Analyze your first song</a>
    </div>
  {/if}

  {#if programs.length > 0}<div class="section-heading">
      <h2>Programs</h2>
      <span>{programs.length} total</span>
    </div>{/if}
  <ul class="list">
    {#each programs as program (program.id)}
      <li class="card row">
        <button type="button" class="open" onclick={() => onopen(program.id)}>
          <strong>{program.name}</strong>
          <span class="muted">
            {titles[program.trackId] ?? ''} &middot; {program.clips.length} blocks &middot;
            {formatTime(classSeconds(program))}
          </span>
        </button>
        <a class="button" href={hrefs.run('program', program.id)}>Start class</a>
        <button type="button" class="danger" onclick={() => remove(program.id)}>
          {confirming === program.id ? 'Tap again to delete' : 'Delete'}
        </button>
      </li>
    {/each}
  </ul>

  <div class="section-heading plans-heading">
    <div>
      <span class="eyebrow">Sequence the room</span>
      <h2>Class plans</h2>
    </div>
  </div>
  <p class="muted section-copy">Build a full class by arranging several programs in a row.</p>
  <ul class="list">
    {#each plans as plan (plan.id)}
      <li class="card row">
        <a class="open plan" href={hrefs.plan(plan.id)}>
          <strong>{plan.name}</strong>
          <span class="muted">
            {plan.programIds.length}
            {plan.programIds.length === 1 ? 'song' : 'songs'}
          </span>
        </a>
        {#if plan.programIds.length > 0}
          <a class="button" href={hrefs.run('plan', plan.id)}>Start class</a>
        {/if}
      </li>
    {/each}
  </ul>
  <button type="button" class="outline-accent" onclick={newPlan}>New class plan</button>
</main>

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .hero {
    position: relative;
    min-height: 330px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 48px 0 38px;
    margin-bottom: 44px;
  }
  .brand-lockup {
    position: relative;
    z-index: 1;
  }
  .brand-lockup h1 {
    margin: 4px 0 8px;
    font-size: clamp(4.5rem, 15vw, 9.5rem);
    line-height: 0.78;
    letter-spacing: -0.085em;
  }
  .brand-lockup h1 span {
    color: var(--pink);
    text-shadow: 0 0 32px rgb(252 3 102 / 0.5);
  }
  .brand-lockup p {
    margin: 20px 0 0;
    font-size: clamp(1.05rem, 2.2vw, 1.4rem);
    color: var(--muted);
  }
  .hero-actions {
    position: relative;
    z-index: 1;
    margin-top: 28px;
  }
  .hero-actions > a {
    display: inline-flex;
    text-decoration: none;
  }
  .hero-actions > a button {
    height: 100%;
  }
  .energy-mark {
    position: absolute;
    right: -6vw;
    top: 32px;
    width: min(53vw, 520px);
    height: 210px;
    display: flex;
    align-items: flex-end;
    gap: 8px;
    opacity: 0.8;
    transform: skewX(-18deg);
    filter: drop-shadow(0 0 28px rgb(36 3 252 / 0.4));
  }
  .energy-mark i {
    flex: 1;
    background: linear-gradient(180deg, var(--pink), var(--violet));
    clip-path: polygon(30% 0, 100% 0, 70% 100%, 0 100%);
  }
  .energy-mark i:nth-child(1) {
    height: 20%;
  }
  .energy-mark i:nth-child(2) {
    height: 35%;
  }
  .energy-mark i:nth-child(3) {
    height: 52%;
  }
  .energy-mark i:nth-child(4) {
    height: 74%;
  }
  .energy-mark i:nth-child(5) {
    height: 100%;
  }
  .section-heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    margin: 0 0 14px;
  }
  .section-heading h2 {
    font-size: clamp(1.8rem, 4vw, 2.6rem);
  }
  .section-heading > span {
    color: var(--muted);
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .plans-heading {
    margin-top: 64px;
  }
  .section-copy {
    margin: -8px 0 18px;
  }
  .empty-state {
    padding: 34px 0 42px;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  .empty-state h2 {
    max-width: 660px;
    font-size: clamp(2.2rem, 7vw, 4.5rem);
    margin: 10px 0;
  }
  .empty-state p {
    max-width: 520px;
    margin-bottom: 22px;
  }
  .legacy-copy {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .open {
    flex: 1;
    text-align: left;
    display: flex;
    flex-direction: column;
    min-height: var(--tap);
  }
  .plan {
    color: inherit;
  }
  .file input {
    display: none;
  }
  .file .button {
    display: inline-flex;
    align-items: center;
    min-height: var(--tap);
    padding: 4px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    cursor: pointer;
  }
  .quiet {
    background: transparent;
    border-color: transparent;
  }
  @media (max-width: 620px) {
    .hero {
      min-height: 300px;
      padding-top: 36px;
    }
    .energy-mark {
      right: -25vw;
      width: 85vw;
      opacity: 0.5;
    }
    .hero-actions {
      align-items: stretch;
    }
    .hero-actions > * {
      flex: 1 1 auto;
      justify-content: center;
      text-align: center;
    }
    .card.row {
      align-items: stretch;
    }
    .card.row > .button,
    .card.row > button.danger {
      flex: 1;
    }
  }
  a {
    text-decoration: none;
  }
</style>
