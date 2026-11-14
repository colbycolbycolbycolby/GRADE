import { describe, expect, test } from 'vitest';
import { makeProgram, makeServices, track } from '../testing/fixtures';
import { classSeconds, ensureTrackData, exportProgram, importProgramText } from './programFiles';

describe('program files', () => {
  test('export names the file after the program and round-trips', async () => {
    const services = makeServices();
    const program = makeProgram('Hill Climb #2!');
    const file = exportProgram(program);
    expect(file.filename).toBe('Hill_Climb_2.grade.json');
    const imported = await importProgramText(services, file.text);
    expect(imported.segments).toEqual(program.segments);
    expect(imported.clips).toEqual(program.clips);
  });

  test('import gives a new id so it never replaces a program', async () => {
    const services = makeServices();
    await services.storage.saveProgram(makeProgram());
    const imported = await importProgramText(services, exportProgram(makeProgram()).text);
    expect(imported.id).not.toBe('p1');
    expect(await services.storage.listPrograms()).toHaveLength(2);
  });

  test('import fetches a missing track and analysis from the server', async () => {
    const services = makeServices();
    expect(await services.storage.getTrack(track.id)).toBeUndefined();
    await importProgramText(services, exportProgram(makeProgram()).text);
    expect((await services.storage.getTrack(track.id))?.title).toBe('Test Song');
    expect(await services.storage.getAnalysis(track.id)).toBeDefined();
  });

  test('import explains when the server does not have the song', async () => {
    const services = makeServices();
    services.fake.tracks.clear();
    await expect(importProgramText(services, exportProgram(makeProgram()).text)).rejects.toThrow(
      /does not have/,
    );
    expect(await services.storage.listPrograms()).toEqual([]);
  });

  test('import rejects text that is not a program', async () => {
    const services = makeServices();
    await expect(importProgramText(services, 'not json')).rejects.toThrow(/JSON/);
    await expect(importProgramText(services, '{"schemaVersion":1,"program":{}}')).rejects.toThrow();
  });

  test('ensureTrackData does not call the server when data is local', async () => {
    const services = makeServices();
    await importProgramText(services, exportProgram(makeProgram()).text);
    const before = services.fake.calls.length;
    await ensureTrackData(services, track.id);
    expect(services.fake.calls.length).toBe(before);
  });

  test('classSeconds adds the clip lengths', () => {
    expect(classSeconds(makeProgram())).toBe(120);
  });
});
