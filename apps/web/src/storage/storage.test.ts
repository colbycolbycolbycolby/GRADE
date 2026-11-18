import { describe, expect, test } from 'vitest';
import { makeAnalysis, makeProgram, track } from '../testing/fixtures';
import { GradeDb } from './db';
import { Storage, StorageError } from './storage';

let n = 0;
const fresh = () => `storage-test-${++n}`;

describe('Storage', () => {
  test('saves and reads tracks, analyses and programs', async () => {
    const s = new Storage(new GradeDb(fresh()));
    await s.saveTrack(track);
    await s.saveAnalysis(makeAnalysis());
    await s.saveProgram(makeProgram());
    expect(await s.getTrack(track.id)).toEqual(track);
    expect((await s.getAnalysis(track.id))?.boundaries).toEqual([32, 62, 92]);
    expect((await s.getProgram('p1'))?.name).toBe('Test Song');
    expect(await s.getProgram('missing')).toBeUndefined();
  });

  test('data survives a reload (a new Storage on the same database)', async () => {
    const name = fresh();
    const first = new Storage(new GradeDb(name));
    await first.saveProgram(makeProgram('Kept'));
    first.db.close();
    const second = new Storage(new GradeDb(name));
    expect((await second.getProgram('p1'))?.name).toBe('Kept');
  });

  test('lists programs newest first', async () => {
    const s = new Storage(new GradeDb(fresh()));
    const base = makeProgram();
    await s.saveProgram({ ...base, id: 'old', updatedAt: '2026-01-01T00:00:00Z' });
    await s.saveProgram({ ...base, id: 'new', updatedAt: '2026-05-01T00:00:00Z' });
    await s.saveProgram({ ...base, id: 'mid', updatedAt: '2026-03-01T00:00:00Z' });
    expect((await s.listPrograms()).map((p) => p.id)).toEqual(['new', 'mid', 'old']);
  });

  test('workout metadata is available after reopening the planner-facing catalog', async () => {
    const name = fresh();
    const first = new Storage(new GradeDb(name));
    const program = makeProgram();
    program.tags = ['endurance'];
    program.workoutFormat = 'endurance';
    program.segments[0] = { ...program.segments[0]!, label: 'Z2 80 Seated' };
    await first.saveProgram(program);
    first.db.close();
    const reopened = new Storage(new GradeDb(name));
    const metadata = (await reopened.listProgramWorkoutMetadata())[0]!;
    expect(metadata).toMatchObject({
      programId: 'p1',
      workoutFormat: 'endurance',
      tags: ['endurance'],
    });
    expect(metadata.segments[0]).toMatchObject({
      resistanceZone: 2,
      cadence: { minRpm: 80 },
      position: 'seated',
    });
  });

  test('keeps one analysis per track and never replaces a newer version', async () => {
    const s = new Storage(new GradeDb(fresh()));
    await s.saveAnalysis({ ...makeAnalysis(), version: 2 });
    await s.saveAnalysis({ ...makeAnalysis(), version: 1 });
    expect((await s.getAnalysis(track.id))?.version).toBe(2);
    await s.saveAnalysis({ ...makeAnalysis(), version: 3 });
    expect((await s.getAnalysis(track.id))?.version).toBe(3);
  });

  test('deletes programs', async () => {
    const s = new Storage(new GradeDb(fresh()));
    await s.saveProgram(makeProgram());
    await s.deleteProgram('p1');
    expect(await s.listPrograms()).toEqual([]);
  });

  test('class plans and settings', async () => {
    const s = new Storage(new GradeDb(fresh()));
    await s.saveClassPlan({ id: 'c1', name: 'Monday', programIds: ['p1'] });
    expect(await s.listClassPlans()).toHaveLength(1);
    await s.deleteClassPlan('c1');
    expect(await s.listClassPlans()).toHaveLength(0);
    expect(await s.getSetting('theme', 'auto')).toBe('auto');
    await s.setSetting('theme', 'dark');
    expect(await s.getSetting('theme', 'auto')).toBe('dark');
  });

  test('a failing database raises StorageError, never fails silently', async () => {
    const s = new Storage(new GradeDb(fresh()));
    s.db.programs.put = (() => Promise.reject(new Error('QuotaExceededError'))) as never;
    await expect(s.saveProgram(makeProgram())).rejects.toBeInstanceOf(StorageError);
    await expect(s.saveProgram(makeProgram())).rejects.toThrow(/save the program/);
  });
});
