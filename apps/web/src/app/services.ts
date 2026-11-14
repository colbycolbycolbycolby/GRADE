import {
  LocalAudioBackend,
  realClock,
  ScreenWakeLock,
  type Clock,
  type PlaybackBackend,
} from '../playback';
import { ApiClient } from '../api/client';
import { Storage } from '../storage/storage';

/** Everything with side effects. Components get it as a prop, so tests can replace each part. */
export interface Services {
  storage: Storage;
  api: ApiClient;
  /** Makes the backend that the editor uses to preview the song. */
  createBackend: (context?: AudioContext) => PlaybackBackend;
  /** Makes the audio context that all songs of one class plan share. */
  createContext: () => AudioContext;
  createWakeLock: () => ScreenWakeLock;
  /** The time source of the class runner. */
  clock: Clock;
  now: () => string;
  newId: () => string;
  /** Gives the user a text file. */
  download: (filename: string, text: string) => void;
}

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createServices(): Services {
  return {
    storage: new Storage(),
    api: new ApiClient(),
    createBackend: (context) =>
      context ? new LocalAudioBackend(() => context, false) : new LocalAudioBackend(),
    createContext: () => new AudioContext(),
    createWakeLock: () => new ScreenWakeLock(),
    clock: realClock,
    now: () => new Date().toISOString(),
    newId: () => crypto.randomUUID(),
    download: downloadText,
  };
}
