import { expect, test } from 'vitest';
import { MIN_SEGMENT_SEC } from '@grade/core';

test('web resolves the core package', () => {
  expect(MIN_SEGMENT_SEC).toBe(2);
});
