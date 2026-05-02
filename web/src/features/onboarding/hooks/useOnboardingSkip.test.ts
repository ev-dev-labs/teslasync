import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import {
  useOnboardingSkip,
  isOnboardingSkippedSync,
} from './useOnboardingSkip';

const STORAGE_KEY = 'teslasync:onboarding:skipped:v1';

describe('useOnboardingSkip', () => {
  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
  });

  it('reads false by default', () => {
    const { result } = renderHook(() => useOnboardingSkip());
    expect(result.current.isSkipped).toBe(false);
    expect(isOnboardingSkippedSync()).toBe(false);
  });

  it('skip() persists to localStorage and updates state', () => {
    const { result } = renderHook(() => useOnboardingSkip());
    act(() => {
      result.current.skip();
    });
    expect(result.current.isSkipped).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');
    expect(isOnboardingSkippedSync()).toBe(true);
  });

  it('unskip() clears localStorage and updates state', () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    const { result } = renderHook(() => useOnboardingSkip());
    expect(result.current.isSkipped).toBe(true);

    act(() => {
      result.current.unskip();
    });
    expect(result.current.isSkipped).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('hydrates true when localStorage already has the flag', () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    const { result } = renderHook(() => useOnboardingSkip());
    expect(result.current.isSkipped).toBe(true);
  });
});
