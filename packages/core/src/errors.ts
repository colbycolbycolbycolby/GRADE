export type CoreErrorCode =
  | 'segment_not_found'
  | 'clip_not_found'
  | 'invalid_position'
  | 'too_short'
  | 'would_empty'
  | 'invalid_argument'
  | 'invalid_program'
  | 'unsupported_version'
  | 'nothing_to_undo';

export class CoreError extends Error {
  constructor(
    readonly code: CoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CoreError';
  }
}
