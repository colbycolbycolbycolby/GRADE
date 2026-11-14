import { describe, expect, test } from 'vitest';
import { ERROR_CODES } from '@grade/schema';
import { ApiError } from '../api/client';
import { API_ERROR_TEXT, describeError } from './errors';

describe('describeError', () => {
  test.each([...ERROR_CODES, 'network_error', 'bad_response'])(
    'code %s has its own text that the server message does not replace',
    (code) => {
      const text = describeError(new ApiError(code, 'RAW SERVER TEXT'));
      expect(text).toBe(API_ERROR_TEXT[code as keyof typeof API_ERROR_TEXT]);
      expect(text).not.toContain('RAW SERVER TEXT');
      expect(text.length).toBeGreaterThan(20);
    },
  );

  test('an unknown code shows the server message', () => {
    expect(describeError(new ApiError('new_code', 'A new problem.'))).toBe('A new problem.');
  });

  test('an unknown error gives a general sentence', () => {
    expect(describeError(new TypeError('x'))).toBe('Something went wrong. Try again.');
  });
});
