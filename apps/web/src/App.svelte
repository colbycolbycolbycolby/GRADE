<script lang="ts">
  import { onMount } from 'svelte';
  import Analyzing from './app/Analyzing.svelte';
  import Import from './app/Import.svelte';
  import Library from './app/Library.svelte';
  import PlanPage from './app/PlanPage.svelte';
  import ProgramPage from './app/ProgramPage.svelte';
  import RunPage from './app/RunPage.svelte';
  import Settings from './app/Settings.svelte';
  import { applyTheme, loadTheme } from './app/settings';
  import { hrefs, parseRoute, type Route } from './app/router';
  import type { Services } from './app/services';
  import { describeError } from './app/errors';

  interface Props {
    services: Services;
  }
  let { services }: Props = $props();

  let route: Route = $state(parseRoute(location.hash));
  let storageError = $state('');

  const go = (href: string) => {
    location.hash = href;
  };

  onMount(() => {
    const onHash = () => (route = parseRoute(location.hash));
    window.addEventListener('hashchange', onHash);
    // Open storage now, so a blocked database shows a message instead of failing silently.
    services.storage
      .check()
      .then(() => loadTheme(services.storage))
      .then(applyTheme)
      .catch((err) => (storageError = describeError(err)));
    return () => window.removeEventListener('hashchange', onHash);
  });
</script>

{#if storageError}
  <div class="banner error" role="alert">{storageError} Programs cannot be saved.</div>
{/if}

{#key route.name === 'program' || route.name === 'plan' || route.name === 'run' ? `${route.name}:${route.id}` : route.name}
  {#if route.name === 'library'}
    <Library {services} onopen={(id) => go(hrefs.program(id))} />
  {:else if route.name === 'import'}
    <Import {services} onstarted={(jobId, trackId) => go(hrefs.analyzing(jobId, trackId))} />
  {:else if route.name === 'settings'}
    <Settings {services} />
  {:else if route.name === 'analyzing'}
    <Analyzing
      {services}
      jobId={route.jobId}
      trackId={route.trackId}
      ondone={(id) => go(hrefs.program(id))}
    />
  {:else if route.name === 'plan'}
    <PlanPage
      {services}
      id={route.id}
      onexit={() => go(hrefs.library())}
      onrun={() => go(hrefs.run('plan', (route as { id: string }).id))}
    />
  {:else if route.name === 'run'}
    {@const run = route}
    <RunPage
      {services}
      kind={run.kind}
      id={run.id}
      onexit={() => go(run.kind === 'program' ? hrefs.program(run.id) : hrefs.plan(run.id))}
    />
  {:else}
    <ProgramPage {services} id={route.id} />
  {/if}
{/key}
