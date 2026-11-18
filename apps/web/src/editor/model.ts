import {
  canRedo,
  canUndo,
  commit,
  createHistory,
  CoreError,
  deleteSegment,
  generateIntervals,
  mergeIntoPrevious,
  moveBoundary,
  recognizeWorkoutTitle,
  redo,
  setLabel,
  setTier,
  setWorkoutFields,
  splitSegment,
  undo,
  type Change,
  type EditResult,
  type History,
} from '@grade/core';
import type { Position, Program, Tier, WorkoutFormat } from '@grade/schema';

export interface Notice {
  kind: 'info' | 'error';
  text: string;
}

export interface EditorState {
  history: History<Program>;
  selectedSegmentId: string | null;
  /** Real song time (crop-relative) of the playhead. */
  playhead: number;
  notice: Notice | null;
}

export type Command =
  | { type: 'select-segment'; id: string | null }
  | { type: 'set-playhead'; t: number }
  | { type: 'set-tier'; segmentId: string; tier: Tier }
  | { type: 'set-label'; segmentId: string; label: string | null }
  | {
      type: 'set-workout-fields';
      segmentId: string;
      resistanceZone?: number;
      cadence?: { minRpm: number; maxRpm?: number };
      position?: Position;
    }
  | { type: 'split'; segmentId: string; at: number }
  | { type: 'merge'; segmentId: string }
  | { type: 'delete-segment'; segmentId: string }
  | { type: 'move-boundary'; index: number; to: number }
  | { type: 'intervals'; from: number; onSec: number; offSec: number; label?: string }
  | { type: 'rename-program'; name: string }
  | { type: 'set-program-tags'; tags: string[] }
  | { type: 'set-workout-format'; workoutFormat?: WorkoutFormat }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'dismiss-notice' };

export interface Env {
  now: () => string;
  newId?: () => string;
}

export function createEditor(program: Program): EditorState {
  return {
    history: createHistory(program),
    selectedSegmentId: program.segments[0]?.id ?? null,
    playhead: 0,
    notice: null,
  };
}

export const programOf = (s: EditorState): Program => s.history.present;
export const canUndoState = (s: EditorState): boolean => canUndo(s.history);
export const canRedoState = (s: EditorState): boolean => canRedo(s.history);

/** Labels already used in this program, for rename autocomplete. */
export function usedLabels(program: Program): string[] {
  return [...new Set(program.segments.map((s) => s.label).filter((l): l is string => !!l))].sort();
}

export function describeChanges(changes: Change[]): string | null {
  if (changes.length === 0) return null;
  return 'Sections updated. Runner countdowns follow these waveform boundaries.';
}

function selectionAfter(s: EditorState, program: Program): string | null {
  const id = s.selectedSegmentId;
  return id && program.segments.some((x) => x.id === id) ? id : (program.segments[0]?.id ?? null);
}

/** Applies one command. Core errors become an error notice and leave the program unchanged. */
export function reduce(s: EditorState, c: Command, env: Env): EditorState {
  const program = s.history.present;
  const opts = env.newId ? { newId: env.newId } : undefined;
  const stamp = (p: Program): Program => ({ ...p, updatedAt: env.now() });

  const edit = (next: Program, extra: Partial<EditorState> = {}, notice: Notice | null = null) => {
    const history = commit(s.history, stamp(next));
    return { ...s, ...extra, history, notice };
  };
  const structural = (r: EditResult): EditorState => {
    const text = describeChanges(r.changes);
    const next = edit(r.program, {}, text ? { kind: 'info', text } : null);
    return { ...next, selectedSegmentId: selectionAfter(s, next.history.present) };
  };

  try {
    switch (c.type) {
      case 'select-segment':
        return { ...s, selectedSegmentId: c.id };
      case 'set-playhead':
        return { ...s, playhead: Math.max(c.t, 0) };
      case 'set-tier':
        return edit(setTier(program, c.segmentId, c.tier));
      case 'set-label': {
        const labeled = setLabel(program, c.segmentId, c.label);
        const segment = labeled.segments.find((candidate) => candidate.id === c.segmentId)!;
        const recognized = recognizeWorkoutTitle(segment.label);
        return edit(
          setWorkoutFields(labeled, c.segmentId, {
            resistanceZone: segment.resistanceZone ?? recognized.resistanceZone,
            cadence: segment.cadence ?? recognized.cadence,
            position: segment.position ?? recognized.position,
          }),
        );
      }
      case 'set-workout-fields':
        return edit(
          setWorkoutFields(program, c.segmentId, {
            resistanceZone: c.resistanceZone,
            cadence: c.cadence,
            position: c.position,
          }),
        );
      case 'split':
        return structural(splitSegment(program, c.segmentId, c.at, opts));
      case 'merge':
        return structural(mergeIntoPrevious(program, c.segmentId, opts));
      case 'delete-segment':
        return structural(deleteSegment(program, c.segmentId, opts));
      case 'move-boundary':
        return structural(moveBoundary(program, c.index, c.to, opts));
      case 'intervals':
        return structural(generateIntervals(program, c.from, c.onSec, c.offSec, c.label, opts));
      case 'rename-program':
        return edit({ ...program, name: c.name.trim() || program.name }, {});
      case 'set-program-tags':
        return edit({ ...program, tags: c.tags });
      case 'set-workout-format':
        return edit({ ...program, workoutFormat: c.workoutFormat });
      case 'undo': {
        const history = undo(s.history);
        return {
          ...s,
          history,
          selectedSegmentId: selectionAfter(s, history.present),
          notice: null,
        };
      }
      case 'redo': {
        const history = redo(s.history);
        return {
          ...s,
          history,
          selectedSegmentId: selectionAfter(s, history.present),
          notice: null,
        };
      }
      case 'dismiss-notice':
        return { ...s, notice: null };
    }
  } catch (err) {
    if (err instanceof CoreError) return { ...s, notice: { kind: 'error', text: err.message } };
    throw err;
  }
}
