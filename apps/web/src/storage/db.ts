import Dexie, { type EntityTable } from 'dexie';
import type { Analysis, ClassPlan, Program, Track } from '@grade/schema';

export interface AudioBlobRow {
  trackId: string;
  blob: Blob;
  savedAt: string;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

/**
 * Version 1 is the first schema. To change it, add `this.version(2).stores({...}).upgrade(...)`
 * below and keep the version 1 line, so old databases migrate in place.
 */
export class GradeDb extends Dexie {
  tracks!: EntityTable<Track, 'id'>;
  analyses!: EntityTable<Analysis, 'trackId'>;
  programs!: EntityTable<Program, 'id'>;
  classPlans!: EntityTable<ClassPlan, 'id'>;
  audioBlobs!: EntityTable<AudioBlobRow, 'trackId'>;
  settings!: EntityTable<SettingRow, 'key'>;

  constructor(name = 'grade') {
    super(name);
    this.version(1).stores({
      tracks: 'id, source',
      analyses: 'trackId',
      programs: 'id, trackId, updatedAt',
      classPlans: 'id',
      audioBlobs: 'trackId',
      settings: 'key',
    });
  }
}
