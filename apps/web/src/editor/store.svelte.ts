import type { Program } from '@grade/schema';
import { createEditor, programOf, reduce, type Command, type EditorState, type Env } from './model';

export type SaveStatus = 'saved' | 'saving' | 'error';

const SAVE_DELAY_MS = 300;

/** Holds the editor state for the UI and saves the program after each change. */
export class EditorStore {
  state: EditorState;
  saveStatus: SaveStatus;
  saveError: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> = Promise.resolve();

  constructor(
    program: Program,
    private readonly env: Env,
    private readonly save: (program: Program) => Promise<void>,
  ) {
    // A snapshot, so a proxy from the caller never reaches IndexedDB.
    this.state = $state.raw(createEditor($state.snapshot(program) as Program));
    this.saveStatus = $state<SaveStatus>('saved');
    this.saveError = $state('');
  }

  get program(): Program {
    return programOf(this.state);
  }

  dispatch(command: Command): void {
    const before = this.program;
    this.state = reduce(this.state, command, this.env);
    if (this.program !== before) this.schedule();
  }

  /** Saves now and waits for the save to end. Call it before the editor closes. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
      this.persist();
    }
    await this.running;
  }

  private schedule(): void {
    this.saveStatus = 'saving';
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.persist();
    }, SAVE_DELAY_MS);
  }

  private persist(): void {
    const program = this.program;
    this.running = this.running.then(async () => {
      try {
        await this.save(program);
        if (this.program === program && this.timer === null) this.saveStatus = 'saved';
        this.saveError = '';
      } catch (err) {
        this.saveStatus = 'error';
        this.saveError = err instanceof Error ? err.message : 'Could not save.';
      }
    });
  }
}
