<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { ScheduleItem } from '@grade/core';
  import { classToRealTime } from '@grade/core';
  import type { ClassPlan, Program } from '@grade/schema';
  import { formatTime } from '../editor/geometry';
  import { attachLifecycle, PlanPlayer, type PlanSong, type ScreenWakeLock } from '../playback';
  import { classEnergy, energyAt, type EnergyPoint } from '../runner/energy';
  import RunnerView from '../runner/RunnerView.svelte';
  import { describeError } from './errors';
  import { loadGlitch } from './settings';
  import { ensureTrackData, classSeconds } from './programFiles';
  import type { Services } from './services';

  interface Props {
    services: Services;
    kind: 'program' | 'plan';
    id: string;
    /** Called when the user leaves. The page has stopped the class by then. */
    onexit: () => void;
  }
  let { services, kind, id, onexit }: Props = $props();

  type Phase = 'loading' | 'ready' | 'running' | 'ended' | 'error';
  let phase: Phase = $state('loading');
  let error = $state('');
  let notice = $state('');
  let name = $state('');
  let songs: PlanSong[] = $state.raw([]);
  let songIndex = $state(0);
  let loadingNext = $state(false);
  let starting = $state(false);
  let playing = $state(false);
  let keepAwake: 'held' | 'unsupported' | 'lost' = $state('lost');

  let schedule: ScheduleItem[] = $state.raw([]);
  let energy: EnergyPoint[] = $state.raw([]);
  let current: ScheduleItem | null = $state.raw(null);
  let upcoming: ScheduleItem[] = $state.raw([]);
  let blockRemaining = $state(0);
  let classTime = $state(0);
  let pulse = $state(0);

  let player: PlanPlayer | null = null;
  let wake: ScreenWakeLock | null = null;
  let off: (() => void)[] = [];

  const classTotal = $derived(schedule.length ? schedule[schedule.length - 1]!.classEnd : 0);
  const boundaries = $derived(schedule.slice(1).map((s) => s.classStart));
  const song = $derived(songs[songIndex]);

  onMount(async () => {
    try {
      let programs: Program[];
      if (kind === 'program') {
        const program = await services.storage.getProgram(id);
        if (!program) throw new Error('This program does not exist.');
        name = program.name;
        programs = [program];
      } else {
        const plan = (await services.storage.listClassPlans()).find((p) => p.id === id);
        if (!plan) throw new Error('This class plan does not exist.');
        name = plan.name;
        programs = await loadPrograms(plan);
      }
      const loaded: PlanSong[] = [];
      for (const program of programs) {
        await ensureTrackData(services, program.trackId);
        const [track, analysis] = await Promise.all([
          services.storage.getTrack(program.trackId),
          services.storage.getAnalysis(program.trackId),
        ]);
        if (!track || !analysis) throw new Error('The song data for a program is missing.');
        loaded.push({ program, track, analysis });
      }
      if (loaded.length === 0) throw new Error('This class plan has no programs.');
      songs = loaded;
      const glitch = await loadGlitch(services.storage);
      player = new PlanPlayer(loaded, {
        glitch: () => glitch,
        createBackend: services.createBackend,
        createContext: services.createContext,
        clock: services.clock,
        audioUrl: (trackId) => services.api.audioUrl(trackId),
      });
      wire(player);
      showSong(0, player.scheduleOf(0));
      phase = 'ready';
      // Load the first song now, so the Start tap only resumes the audio.
      void player.prepare().catch(() => undefined);
    } catch (err) {
      fail(err);
    }
  });

  onDestroy(() => void shutdown());

  async function loadPrograms(plan: ClassPlan): Promise<Program[]> {
    const all = await services.storage.listPrograms();
    return plan.programIds.map((pid) => {
      const found = all.find((p) => p.id === pid);
      if (!found) throw new Error('A program in this class plan was deleted.');
      return found;
    });
  }

  /** Plain errors here carry a message that this page or the player wrote for the user. */
  function messageOf(err: unknown): string {
    return err instanceof Error && err.constructor === Error ? err.message : describeError(err);
  }

  function fail(err: unknown) {
    error = messageOf(err);
    phase = 'error';
  }

  function showSong(index: number, items: ScheduleItem[]) {
    songIndex = index;
    schedule = items;
    energy = classEnergy(songs[index]!.analysis, items);
    current = items[0] ?? null;
    upcoming = items.slice(1, 4);
    classTime = 0;
    blockRemaining = items[0] ? items[0].classEnd - items[0].classStart : 0;
  }

  function wire(p: PlanPlayer) {
    off.push(
      attachLifecycle(p),
      p.on('song', (e) => {
        loadingNext = e.loading;
        showSong(e.songIndex, e.schedule);
      }),
      p.on('block', (e) => {
        current = e.item;
        upcoming = e.upcoming;
      }),
      p.on('tick', (e) => {
        classTime = e.classTime;
        blockRemaining = e.blockRemaining;
        playing = p.isPlaying;
        const s = songs[e.songIndex];
        if (s) pulse = energyAt(s.analysis, classToRealTime(schedule, e.classTime));
      }),
      p.on('ended', () => {
        playing = false;
        phase = 'ended';
        void releaseWake();
      }),
      p.on('error', (e) => {
        notice = e.message;
      }),
    );
  }

  async function start() {
    if (!player || starting) return;
    starting = true;
    notice = '';
    try {
      wake = services.createWakeLock();
      // Both calls run inside the tap, so the browser lets the audio and the screen lock start.
      const lockDone = wake.acquire();
      await player.start();
      keepAwake = (await lockDone) ? 'held' : wake.supported ? 'lost' : 'unsupported';
      phase = 'running';
      playing = true;
    } catch (err) {
      notice = `The class could not start. ${messageOf(err)}`;
      await releaseWake();
    } finally {
      starting = false;
    }
  }

  async function playPause() {
    if (!player) return;
    if (player.isPlaying) {
      player.pause();
      playing = false;
    } else {
      await player.resume();
      playing = player.isPlaying;
    }
  }

  async function releaseWake() {
    const w = wake;
    wake = null;
    keepAwake = 'lost';
    await w?.release();
  }

  async function shutdown() {
    for (const fn of off) fn();
    off = [];
    player?.dispose();
    player = null;
    await releaseWake();
  }

  async function exit() {
    await shutdown();
    onexit();
  }

  const total = $derived(songs.reduce((sum, s) => sum + classSeconds(s.program), 0));
</script>

{#if phase === 'running' && current && song}
  <RunnerView
    tier={current.tier}
    title={current.title}
    songTitle={song.track.title}
    {songIndex}
    songCount={songs.length}
    {blockRemaining}
    {upcoming}
    {playing}
    waitingForSong={loadingNext}
    {classTime}
    {classTotal}
    {energy}
    {boundaries}
    {pulse}
    {keepAwake}
    {notice}
    onplaypause={playPause}
    onskip={(d) => void player?.skip(d)}
    onnext={() => void player?.nextSong()}
    onend={exit}
  />
{:else}
  <main>
    <a
      href="#/"
      onclick={(e) => {
        e.preventDefault();
        void exit();
      }}>&larr; Library</a
    >
    <h1>{name || 'Class'}</h1>
    {#if phase === 'loading'}
      <p class="muted">Loading&hellip;</p>
    {:else if phase === 'error'}
      <div class="banner error" role="alert">{error}</div>
    {:else if phase === 'ended'}
      <p role="status"><strong>Class finished.</strong></p>
      <button type="button" class="primary" onclick={exit}>Back to the library</button>
    {:else}
      <p class="muted">
        {songs.length}
        {songs.length === 1 ? 'song' : 'songs'} &middot; {formatTime(total)}
      </p>
      <ol class="card">
        {#each songs as s (s.program.id + s.track.id)}
          <li>
            {s.program.name}
            <span class="muted">&middot; {formatTime(classSeconds(s.program))}</span>
          </li>
        {/each}
      </ol>
      {#if notice}<div class="banner error" role="alert">{notice}</div>{/if}
      <button type="button" class="primary start" onclick={start} disabled={starting}>
        {starting ? 'Starting…' : 'Start class'}
      </button>
      <p class="muted">Tap Start to begin. The first song loads now.</p>
    {/if}
  </main>
{/if}

<style>
  .start {
    min-height: 72px;
    width: 100%;
    font-size: 1.4rem;
    font-weight: 700;
  }
  ol {
    margin: 8px 0 16px;
    padding-left: 32px;
  }
</style>
