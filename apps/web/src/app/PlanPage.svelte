<script lang="ts">
  import { onMount } from 'svelte';
  import type { ClassPlan, Program } from '@grade/schema';
  import { formatTime } from '../editor/geometry';
  import { describeError } from './errors';
  import { classSeconds } from './programFiles';
  import { hrefs } from './router';
  import type { Services } from './services';

  interface Props {
    services: Services;
    id: string;
    onexit: () => void;
    onrun: () => void;
  }
  let { services, id, onexit, onrun }: Props = $props();

  let plan = $state.raw<ClassPlan | null>(null);
  let programs: Program[] = $state.raw([]);
  let error = $state('');
  let confirming = $state(false);
  let adding = $state('');

  const byId = $derived(new Map(programs.map((p) => [p.id, p])));
  const missing = $derived(plan ? plan.programIds.some((pid) => !byId.has(pid)) : false);
  const total = $derived(
    plan
      ? plan.programIds.reduce((sum, pid) => sum + classSeconds(byId.get(pid) ?? emptyLike), 0)
      : 0,
  );
  const emptyLike = { clips: [] } as unknown as Program;

  onMount(async () => {
    try {
      programs = await services.storage.listPrograms();
      const found = (await services.storage.listClassPlans()).find((p) => p.id === id);
      if (found) plan = found;
      else error = 'This class plan does not exist.';
    } catch (err) {
      error = describeError(err);
    }
  });

  async function update(next: ClassPlan) {
    plan = next;
    try {
      await services.storage.saveClassPlan(next);
      error = '';
    } catch (err) {
      error = describeError(err);
    }
  }

  function move(index: number, by: number) {
    if (!plan) return;
    const ids = [...plan.programIds];
    const to = index + by;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to]!, ids[index]!];
    void update({ ...plan, programIds: ids });
  }

  function removeAt(index: number) {
    if (!plan) return;
    void update({ ...plan, programIds: plan.programIds.filter((_, i) => i !== index) });
  }

  function add() {
    if (!plan || !adding) return;
    void update({ ...plan, programIds: [...plan.programIds, adding] });
    adding = '';
  }

  async function remove() {
    if (!confirming) {
      confirming = true;
      return;
    }
    try {
      await services.storage.deleteClassPlan(id);
      onexit();
    } catch (err) {
      error = describeError(err);
    }
  }
</script>

<main>
  <a class="back" href={hrefs.library()}>&larr; Library</a>
  {#if error}<div class="banner error" role="alert">{error}</div>{/if}
  {#if plan}
    <span class="eyebrow">Program builder</span>
    <h1>Class plan</h1>
    <label class="field">
      Name
      <input
        type="text"
        aria-label="Plan name"
        value={plan.name}
        onchange={(e) =>
          plan && update({ ...plan, name: e.currentTarget.value.trim() || plan.name })}
      />
    </label>

    <p class="muted">
      {plan.programIds.length}
      {plan.programIds.length === 1 ? 'song' : 'songs'} &middot; {formatTime(total)}
    </p>

    <ol class="list">
      {#each plan.programIds as pid, i (i + pid)}
        {@const program = byId.get(pid)}
        <li class="card row">
          <span class="grow">
            {#if program}
              <strong>{program.name}</strong>
              <span class="muted">&middot; {formatTime(classSeconds(program))}</span>
            {:else}
              <strong class="error-text">This program was deleted.</strong>
            {/if}
          </span>
          <button type="button" aria-label="Move up" disabled={i === 0} onclick={() => move(i, -1)}>
            Up
          </button>
          <button
            type="button"
            aria-label="Move down"
            disabled={i === plan.programIds.length - 1}
            onclick={() => move(i, 1)}
          >
            Down
          </button>
          <button
            type="button"
            class="danger"
            aria-label="Remove from plan"
            onclick={() => removeAt(i)}
          >
            Remove
          </button>
        </li>
      {/each}
    </ol>

    <div class="row">
      <select aria-label="Program to add" bind:value={adding}>
        <option value="">Choose a program</option>
        {#each programs as p (p.id)}
          <option value={p.id}>{p.name}</option>
        {/each}
      </select>
      <button type="button" disabled={!adding} onclick={add}>Add to plan</button>
    </div>

    {#if missing}
      <div class="banner error" role="alert">Remove the deleted programs before you start.</div>
    {/if}

    <div class="row actions">
      <button
        type="button"
        class="primary"
        disabled={plan.programIds.length === 0 || missing}
        onclick={onrun}
      >
        Start class
      </button>
      <button type="button" class="danger" onclick={remove}>
        {confirming ? 'Tap again to delete' : 'Delete plan'}
      </button>
    </div>
  {/if}
</main>

<style>
  .list {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
  }
  h1 {
    font-size: clamp(3rem, 8vw, 5.5rem);
    margin: 8px 0 24px;
    letter-spacing: -0.06em;
  }
  .back {
    display: inline-block;
    margin-bottom: 36px;
  }
  .grow {
    flex: 1;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
  }
  .actions {
    margin-top: 16px;
  }
  @media (max-width: 620px) {
    .list .row {
      align-items: stretch;
    }
    .list .grow {
      flex-basis: 100%;
    }
    .list button {
      flex: 1;
    }
    .actions button {
      flex: 1;
    }
  }
  .error-text {
    color: var(--danger);
  }
  a {
    text-decoration: none;
  }
</style>
