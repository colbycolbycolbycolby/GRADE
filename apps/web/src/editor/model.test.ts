import { describe, expect, test } from 'vitest';
import { makeIdFactory, makeProgram } from '../testing/fixtures';
import {
  canRedoState,
  canUndoState,
  createEditor,
  describeChanges,
  programOf,
  reduce,
  usedLabels,
  type Command,
  type EditorState,
} from './model';

const env = () => ({ now: () => '2026-03-03T00:00:00Z', newId: makeIdFactory('m') });

function run(commands: Command[], start = createEditor(makeProgram())): EditorState {
  const e = env();
  return commands.reduce((s, c) => reduce(s, c, e), start);
}

describe('editor model', () => {
  test('starts with the first section selected and nothing to undo', () => {
    const s = createEditor(makeProgram());
    expect(s.selectedSegmentId).toBe(programOf(s).segments[0]!.id);
    expect(canUndoState(s)).toBe(false);
  });

  test('an edit stamps updatedAt and can be undone and redone', () => {
    const base = createEditor(makeProgram());
    const id = programOf(base).segments[1]!.id;
    const s = run([{ type: 'set-tier', segmentId: id, tier: 'allout' }], base);
    expect(programOf(s).segments[1]!.tier).toBe('allout');
    expect(programOf(s).updatedAt).toBe('2026-03-03T00:00:00Z');
    const undone = run([{ type: 'undo' }], s);
    expect(programOf(undone).segments[1]!.tier).toBe(programOf(base).segments[1]!.tier);
    expect(canRedoState(undone)).toBe(true);
    expect(programOf(run([{ type: 'redo' }], undone)).segments[1]!.tier).toBe('allout');
  });

  test('split adds a section and keeps the label off the new part', () => {
    const base = createEditor(makeProgram());
    const first = programOf(base).segments[0]!;
    const s = run(
      [
        { type: 'set-label', segmentId: first.id, label: 'Warm up' },
        { type: 'split', segmentId: first.id, at: 10 },
      ],
      base,
    );
    const segs = programOf(s).segments;
    expect(segs).toHaveLength(5);
    expect(segs[0]!.label).toBe('Warm up');
    expect(segs[1]!.label).toBeNull();
  });

  test('a core error becomes an error notice and changes nothing', () => {
    const base = createEditor(makeProgram());
    const first = programOf(base).segments[0]!;
    const s = run([{ type: 'split', segmentId: first.id, at: 0.5 }], base);
    expect(s.notice?.kind).toBe('error');
    expect(programOf(s)).toBe(programOf(base));
    expect(canUndoState(s)).toBe(false);
  });

  test('removing every block is refused', () => {
    let s = createEditor(makeProgram());
    const n = programOf(s).clips.length;
    s = run([{ type: 'remove', indices: Array.from({ length: n }, (_, i) => i) }], s);
    expect(s.notice?.kind).toBe('error');
    expect(programOf(s).clips).toHaveLength(n);
  });

  test('deleting a section tells the user what happened to the class order', () => {
    const base = createEditor(makeProgram());
    const id = programOf(base).segments[1]!.id;
    const s = run([{ type: 'delete-segment', segmentId: id }], base);
    expect(programOf(s).segments).toHaveLength(3);
    expect(s.notice?.kind).toBe('info');
    expect(s.notice?.text).toMatch(/removed/);
  });

  test('moving a boundary changes two neighbours', () => {
    const s = run([{ type: 'move-boundary', index: 0, to: 20 }]);
    const segs = programOf(s).segments;
    expect(segs[0]!.end).toBe(20);
    expect(segs[1]!.start).toBe(20);
  });

  test('group selection, reorder and duplicate', () => {
    let s = run([
      { type: 'toggle-clip', index: 3 },
      { type: 'toggle-clip', index: 1 },
    ]);
    expect(s.selectedClips).toEqual([1, 3]);
    const ids = programOf(s).clips.map((c) => c.id);
    s = run([{ type: 'reorder', indices: [1, 3], to: 0 }], s);
    expect(programOf(s).clips.map((c) => c.id)).toEqual([ids[1], ids[3], ids[0], ids[2]]);
    expect(s.selectedClips).toEqual([]);
    s = run([{ type: 'duplicate', indices: [0, 1] }], s);
    expect(programOf(s).clips).toHaveLength(6);
  });

  test('trim keeps the clip inside its section', () => {
    const base = createEditor(makeProgram());
    const clip = programOf(base).clips[0]!;
    const s = run([{ type: 'trim', clipId: clip.id, start: 5, end: 20 }], base);
    expect(programOf(s).clips[0]).toMatchObject({ start: 5, end: 20 });
  });

  test('intervals replace the song after the start time', () => {
    const s = run([{ type: 'intervals', from: 90, onSec: 10, offSec: 10, label: 'Sprint' }]);
    const segs = programOf(s).segments;
    expect(segs.filter((x) => x.label === 'Sprint').length).toBeGreaterThan(1);
    expect(segs[segs.length - 1]!.end).toBe(120);
  });

  test('a blank program name is ignored', () => {
    const s = run([{ type: 'rename-program', name: '   ' }]);
    expect(programOf(s).name).toBe('Test Song');
    expect(programOf(run([{ type: 'rename-program', name: ' Hills ' }])).name).toBe('Hills');
  });

  test('usedLabels lists each label once, sorted', () => {
    const p = makeProgram();
    const labelled = {
      ...p,
      segments: p.segments.map((s, i) => ({ ...s, label: ['B', 'A', 'B', null][i] ?? null })),
    };
    expect(usedLabels(labelled)).toEqual(['A', 'B']);
  });

  test('describeChanges is empty for no changes', () => {
    expect(describeChanges([])).toBeNull();
    expect(describeChanges([{ kind: 'order-reset' }])).toMatch(/song order/);
  });
});
