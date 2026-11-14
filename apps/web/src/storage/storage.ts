import type { Analysis, ClassPlan, Program, Track } from '@grade/schema';
import { GradeDb } from './db';

/** Every storage failure reaches the caller as this error. Nothing fails silently. */
export class StorageError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

async function guard<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (cause) {
    throw new StorageError(`Could not ${what}. The browser storage may be full or blocked.`, cause);
  }
}

export class Storage {
  constructor(readonly db: GradeDb = new GradeDb()) {}

  /** Opens the database. Call once at start so the app can show a banner when storage fails. */
  check(): Promise<void> {
    return guard('open storage', async () => {
      await this.db.open();
    });
  }

  saveTrack(track: Track): Promise<void> {
    return guard('save the track', async () => {
      await this.db.tracks.put(track);
    });
  }
  getTrack(id: string): Promise<Track | undefined> {
    return guard('read the track', () => this.db.tracks.get(id));
  }

  /** Keeps one analysis for each track. A newer analyzer version replaces an older one. */
  saveAnalysis(analysis: Analysis): Promise<void> {
    return guard('save the analysis', async () => {
      const old = await this.db.analyses.get(analysis.trackId);
      if (!old || old.version <= analysis.version) await this.db.analyses.put(analysis);
    });
  }
  getAnalysis(trackId: string): Promise<Analysis | undefined> {
    return guard('read the analysis', () => this.db.analyses.get(trackId));
  }

  saveProgram(program: Program): Promise<void> {
    return guard('save the program', async () => {
      await this.db.programs.put(program);
    });
  }
  getProgram(id: string): Promise<Program | undefined> {
    return guard('read the program', () => this.db.programs.get(id));
  }
  /** Newest first. */
  listPrograms(): Promise<Program[]> {
    return guard('list the programs', async () =>
      (await this.db.programs.toArray()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
  }
  deleteProgram(id: string): Promise<void> {
    return guard('delete the program', () => this.db.programs.delete(id));
  }

  saveClassPlan(plan: ClassPlan): Promise<void> {
    return guard('save the class plan', async () => {
      await this.db.classPlans.put(plan);
    });
  }
  listClassPlans(): Promise<ClassPlan[]> {
    return guard('list the class plans', () => this.db.classPlans.toArray());
  }
  deleteClassPlan(id: string): Promise<void> {
    return guard('delete the class plan', () => this.db.classPlans.delete(id));
  }

  async getSetting<T>(key: string, fallback: T): Promise<T> {
    const row = await guard('read the setting', () => this.db.settings.get(key));
    return row ? (row.value as T) : fallback;
  }
  setSetting(key: string, value: unknown): Promise<void> {
    return guard('save the setting', async () => {
      await this.db.settings.put({ key, value });
    });
  }
}
