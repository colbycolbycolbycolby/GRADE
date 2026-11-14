import {
  canRedo,
  canUndo,
  commit,
  createHistory,
  CoreError,
  deleteSegment,
  duplicateClips,
  generateIntervals,
  mergeIntoPrevious,
  moveBoundary,
  redo,
  removeClips,
  reorderClips,
  setLabel,
  setTier,
  splitSegment,
  trimClip,
  undo,
  type Change,
  type EditResult,
  type History,
} from '@grade/core';
import type { Program, Tier } from '@grade/schema';

export interface Notice {
  kind: 'info' | 'error';
  text: string;
}

export interface EditorState {
  history: History<Program>;
  selectedSegmentId: string | null;
  /** Indices into `program.clips`. */
  selectedClips: number[];
  /** Real song time (crop-relative) of the playhead. */
  playhead: number;
  notice: Notice | null;
}

export type Command =
  | { type: 'select-segment'; id: string | null }
  | { type: 'toggle-clip'; index: number }
  | { type: 'clear-clip-selection' }
  | { type: 'set-playhead'; t: number }
  | { type: 'set-tier'; segmentId: string; tier: Tier }
  | { type: 'set-label'; segmentId: string; label: string | null }
  | { type: 'split'; segmentId: string; at: number }
  | { type: 'merge'; segmentId: string }
  | { type: 'delete-segment'; segmentId: string }
  | { type: 'move-boundary'; index: number; to: number }
  | { type: 'reorder'; indices: number[]; to: number }
  | { type: 'duplicate'; indices: number[] }
  | { type: 'remove'; indices: number[] }
  | { type: 'trim'; clipId: string; start: number; end: number }
  | { type: 'intervals'; from: number; onSec: number; offSec: number; label?: string }
  | { type: 'rename-program'; name: string }
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
    selectedClips: [],
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
  if (changes.some((c) => c.kind === 'order-reset')) {
    return 'The class order could not be kept. It is now in song order.';
  }
  const count = (k: Change['kind']) => changes.filter((c) => c.kind === k).length;
  const parts: string[] = [];
  if (count('clip-dropped')) parts.push(`${count('clip-dropped')} removed`);
  if (count('clip-remapped')) parts.push(`${count('clip-remapped')} moved to a new section`);
  if (count('clip-split')) parts.push(`${count('clip-split')} split`);
  if (count('clip-trimmed')) parts.push(`${count('clip-trimmed')} shortened`);
  return `Class order changed: ${parts.join(', ')}.`;
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
    return { ...s, ...extra, history, notice, selectedClips: extra.selectedClips ?? [] };
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
      case 'toggle-clip': {
        const has = s.selectedClips.includes(c.index);
        const selectedClips = has
          ? s.selectedClips.filter((i) => i !== c.index)
          : [...s.selectedClips, c.index].sort((a, b) => a - b);
        return { ...s, selectedClips };
      }
      case 'clear-clip-selection':
        return { ...s, selectedClips: [] };
      case 'set-playhead':
        return { ...s, playhead: Math.max(c.t, 0) };
      case 'set-tier':
        return edit(setTier(program, c.segmentId, c.tier), { selectedClips: s.selectedClips });
      case 'set-label':
        return edit(setLabel(program, c.segmentId, c.label), { selectedClips: s.selectedClips });
      case 'split':
        return structural(splitSegment(program, c.segmentId, c.at, opts));
      case 'merge':
        return structural(mergeIntoPrevious(program, c.segmentId, opts));
      case 'delete-segment':
        return structural(deleteSegment(program, c.segmentId, opts));
      case 'move-boundary':
        return structural(moveBoundary(program, c.index, c.to, opts));
      case 'reorder':
        return edit(reorderClips(program, c.indices, c.to));
      case 'duplicate':
        return edit(duplicateClips(program, c.indices, opts));
      case 'remove':
        return edit(removeClips(program, c.indices));
      case 'trim':
        return edit(trimClip(program, c.clipId, c.start, c.end));
      case 'intervals':
        return structural(generateIntervals(program, c.from, c.onSec, c.offSec, c.label, opts));
      case 'rename-program':
        return edit(
          { ...program, name: c.name.trim() || program.name },
          {
            selectedClips: s.selectedClips,
          },
        );
      case 'undo': {
        const history = undo(s.history);
        return {
          ...s,
          history,
          selectedClips: [],
          selectedSegmentId: selectionAfter(s, history.present),
          notice: null,
        };
      }
      case 'redo': {
        const history = redo(s.history);
        return {
          ...s,
          history,
          selectedClips: [],
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
