import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

// The hook under test composes the *canonical TanStack Query* settings hook
// (`@/api/hooks/useSettings`), reading only its `.data`. We mock that lower
// hook directly so no QueryClientProvider is required and every branch can be
// driven deterministically — the same strategy used by `useAiEnabled.test.tsx`
// and `useMotionPreference.test.ts`.
//
// NOTE: the global `test-setup.ts` only stubs the *app-level* hook at
// `@/hooks/useSettings`. The API-layer hook this file targets is a DIFFERENT
// module, so it must be mocked explicitly here — otherwise a bare `renderHook`
// would hit the real `useQuery` and crash with "No QueryClient set".
vi.mock('@/api/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/api/hooks/useSettings';
import { useTimeFormatPreference } from '../useTimeFormatPreference';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

/** The minimal slice of the query result the hook reads. */
type QueryResult = { data: Partial<AppSettings> | null | undefined };

function queryResult(data: Partial<AppSettings> | null | undefined): QueryResult {
  return { data };
}

/**
 * Build a settings payload carrying an arbitrary `time_format_default`. The
 * wire is untyped JSON, so `value` is deliberately widened to `string` to let
 * the tests feed values outside the known union (garbage / wrong casing).
 */
function settingsWith(value: string | undefined): Partial<AppSettings> {
  return { time_format_default: value as AppSettings['time_format_default'] };
}

beforeEach(() => {
  mockUseSettings.mockReset();
  // Safe default (loading shape) so any test that renders without an explicit
  // setup still gets `{ data: undefined }` rather than crashing on `.data`.
  mockUseSettings.mockReturnValue(queryResult(undefined));
});

describe('useTimeFormatPreference', () => {
  it('falls back to "relative" before settings have resolved (data undefined)', () => {
    mockUseSettings.mockReturnValue(queryResult(undefined));
    const { result } = renderHook(() => useTimeFormatPreference());
    expect(result.current).toBe('relative');
    // It genuinely sources the value from the canonical settings hook.
    expect(mockUseSettings).toHaveBeenCalled();
  });

  it('returns "absolute" when time_format_default is "absolute"', () => {
    mockUseSettings.mockReturnValue(queryResult(settingsWith('absolute')));
    const { result } = renderHook(() => useTimeFormatPreference());
    expect(result.current).toBe('absolute');
  });

  it('returns "relative" when time_format_default is explicitly "relative"', () => {
    mockUseSettings.mockReturnValue(queryResult(settingsWith('relative')));
    const { result } = renderHook(() => useTimeFormatPreference());
    expect(result.current).toBe('relative');
  });

  it('falls back to "relative" when the field is absent from settings', () => {
    mockUseSettings.mockReturnValue(queryResult({}));
    const { result } = renderHook(() => useTimeFormatPreference());
    expect(result.current).toBe('relative');
  });

  it('falls back to "relative" for an unrecognised (garbage) value', () => {
    // Only an exact "absolute" match may flip the mode; anything else — a
    // stale enum, a typo, a future value — must not leak through.
    mockUseSettings.mockReturnValue(queryResult(settingsWith('24-hour')));
    const { result } = renderHook(() => useTimeFormatPreference());
    expect(result.current).toBe('relative');
  });

  it('is case-sensitive — "Absolute" is not treated as absolute', () => {
    mockUseSettings.mockReturnValue(queryResult(settingsWith('Absolute')));
    const { result } = renderHook(() => useTimeFormatPreference());
    expect(result.current).toBe('relative');
  });

  it('tolerates a null query payload without throwing', () => {
    mockUseSettings.mockReturnValue(queryResult(null));
    const { result } = renderHook(() => useTimeFormatPreference());
    expect(result.current).toBe('relative');
  });

  it('reflects the latest settings when the query result changes on rerender', () => {
    mockUseSettings.mockReturnValue(queryResult(settingsWith('absolute')));
    const { result, rerender } = renderHook(() => useTimeFormatPreference());
    expect(result.current).toBe('absolute');

    // Simulate a cross-tab broadcast / refetch swapping the preference.
    mockUseSettings.mockReturnValue(queryResult(settingsWith('relative')));
    rerender();
    expect(result.current).toBe('relative');
  });

  it('always returns one of the two known modes for any input', () => {
    const inputs: Array<Partial<AppSettings> | null | undefined> = [
      undefined,
      null,
      {},
      settingsWith('relative'),
      settingsWith('absolute'),
      settingsWith('nonsense'),
    ];
    for (const input of inputs) {
      mockUseSettings.mockReturnValue(queryResult(input));
      const { result } = renderHook(() => useTimeFormatPreference());
      expect(['relative', 'absolute']).toContain(result.current);
    }
  });
});
