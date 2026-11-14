import { ERROR_CODES } from '@grade/schema';
import { CoreError } from '@grade/core';
import { ApiError } from '../api/client';
import { StorageError } from '../storage/storage';

/**
 * One user-readable sentence for every code in `ERROR_CODES`, and for the two codes that the
 * client makes itself. The text says what to do next. The server message is not shown, so the
 * words stay the same when the server text changes.
 */
export const API_ERROR_TEXT: Record<
  (typeof ERROR_CODES)[number] | 'network_error' | 'bad_response',
  string
> = {
  invalid_url: 'This is not a valid link. Paste the full YouTube link of one video.',
  unsupported_host: 'Only YouTube links work. Paste a YouTube link or add an audio file.',
  playlist_not_supported: 'This link is a playlist. Paste the link of one video.',
  too_long: 'This song is longer than 15 minutes. Choose a shorter song.',
  video_unavailable: 'This video is not available. It may be private or removed. Try another link.',
  age_restricted:
    'YouTube limits this video by age, so the server cannot download it. Add an audio file instead.',
  blocked:
    'YouTube refused the download. Wait a while and try again, or update yt-dlp on the server.',
  download_failed:
    'The download failed. Check the link and try again. If it keeps failing, update yt-dlp.',
  analysis_failed: 'The server could not analyze this song. Try another file or link.',
  unsupported_audio:
    'The server cannot read this audio file. Use an MP3, M4A, WAV, FLAC or OGG file.',
  too_many_jobs: 'The server is busy with other songs. Wait one minute and try again.',
  not_found: 'The server does not have this song. Import the song again.',
  bad_request: 'The server did not accept the request. Reload the page and try again.',
  range_not_satisfiable: 'The audio request was wrong. Reload the page and try again.',
  forbidden: 'The server refused this request. Open the app from the address of the server.',
  network_error: 'Cannot reach the server. Check that the server runs and that the network works.',
  bad_response:
    'The server sent an answer that the app cannot read. Update the app and the server together.',
};

/** One user-readable sentence for any error the app can meet. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    return (API_ERROR_TEXT as Record<string, string>)[err.code] ?? err.message;
  }
  if (err instanceof StorageError || err instanceof CoreError) return err.message;
  return 'Something went wrong. Try again.';
}
