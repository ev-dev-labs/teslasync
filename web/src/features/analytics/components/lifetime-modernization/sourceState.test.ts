import { describe, expect, it } from 'vitest';
import { lifetimeSectionState } from './sourceState';

describe('lifetime source trust', () => {
  it.each([
    [{ hasData: false, isLoading: true, isError: false, empty: true }, 'loading'],
    [{ hasData: false, isLoading: false, isError: true, empty: true }, 'error'],
    [{ hasData: false, isLoading: false, isError: false, empty: true }, 'empty'],
    [{ hasData: true, isLoading: false, isError: false, empty: false }, 'ready'],
    [{ hasData: true, isLoading: false, isError: true, empty: false }, 'retained'],
    [{ hasData: true, isLoading: true, isError: false, empty: false }, 'ready'],
    [{ hasData: true, isLoading: false, isError: true, empty: true }, 'empty'],
  ] as const)('resolves %j to %s without discarding retained data', (input, expected) => {
    expect(lifetimeSectionState(input)).toBe(expected);
  });
});
