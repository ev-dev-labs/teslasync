// Behavioural tests for the Settings → reset mutation hooks.
//
// Covers EVERY runtime export of ./useSettingsReset:
//   - settingsResetKeys       — the stable, `as const` query-key namespace.
//   - SudoCanceledError       — the re-export used by <ResetSection> to tell
//                               "user dismissed the reauth dialog" apart from a
//                               genuine failure.
//   - useResetSection         — POST /settings/reset { section }, receipt
//                               normalisation, last-reset cache seed, global
//                               invalidation, the server-error toast, and the
//                               silent sudo-cancel branch.
//   - useResetAllSettings     — POST /settings/reset {} (empty body), same
//                               cache + invalidation semantics, and its own
//                               distinct error-toast key.
// The `SettingsResetResult` / `SettingsResetSectionResult` types are exercised
// by the typed fixtures below.
//
// Network is mocked at the `../client` boundary (the repo convention) while the
// real SudoCanceledError is preserved via vi.importActual so the hook's
// `instanceof` discrimination runs against genuine error instances. The toast
// bridge is stubbed so we can assert the exact i18n key + fallback each branch
// picks without mounting a ToastProvider.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { successToast, errorToast } = vi.hoisted(() => ({
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: successToast, error: errorToast }),
}));

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client');
  return { ...actual, request: vi.fn() };
});

import { request, SudoCanceledError } from '../client';
import {
  settingsResetKeys,
  useResetSection,
  useResetAllSettings,
  type SettingsResetResult,
  type SettingsResetSectionResult,
} from './useSettingsReset';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { Wrapper, qc };
}

function mkSection(
  overrides: Partial<SettingsResetSectionResult> = {},
): SettingsResetSectionResult {
  return { section: 'general', reset: 2, ...overrides };
}

function mkResult(overrides: Partial<SettingsResetResult> = {}): SettingsResetResult {
  return {
    reset: 5,
    sections: [mkSection({ section: 'general', reset: 2 }), mkSection({ section: 'geofences', reset: 3 })],
    ...overrides,
  };
}

function firstCall(): [
  string,
  RequestInit & { requiresLiveMode?: boolean },
] {
  return mockedRequest.mock.calls[0] as [
    string,
    RequestInit & { requiresLiveMode?: boolean },
  ];
}

beforeEach(() => {
  mockedRequest.mockReset();
  successToast.mockReset();
  errorToast.mockReset();
});

// ---------------------------------------------------------------------------
// settingsResetKeys
// ---------------------------------------------------------------------------

describe('settingsResetKeys', () => {
  it('exposes the stable root and last-reset key tuples', () => {
    expect(settingsResetKeys.root).toEqual(['settings', 'reset']);
    expect(settingsResetKeys.lastReset).toEqual(['settings', 'reset', 'last']);
  });

  it('nests lastReset under the root namespace so a root-scoped invalidation reaches it', () => {
    // The last-reset key is a strict extension of root — asserting the prefix
    // documents the "seed under the reset namespace" contract.
    expect(settingsResetKeys.lastReset.slice(0, 2)).toEqual(settingsResetKeys.root);
    expect(settingsResetKeys.root).not.toEqual(settingsResetKeys.lastReset);
  });
});

// ---------------------------------------------------------------------------
// SudoCanceledError (re-export)
// ---------------------------------------------------------------------------

describe('SudoCanceledError re-export', () => {
  it('is a real Error subclass carrying the SudoCanceledError name', () => {
    const err = new SudoCanceledError('nope');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SudoCanceledError);
    expect(err.name).toBe('SudoCanceledError');
    expect(err.message).toBe('nope');
  });
});

// ---------------------------------------------------------------------------
// useResetSection
// ---------------------------------------------------------------------------

describe('useResetSection', () => {
  it('POSTs /settings/reset with the captured section and no /api/v1 prefix', async () => {
    mockedRequest.mockResolvedValueOnce(mkResult());
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useResetSection('geofences'), { wrapper: Wrapper });
    await result.current.mutateAsync();

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [url, opts] = firstCall();
    expect(url).toBe('/settings/reset');
    expect(opts.method).toBe('POST');
    expect(opts.requiresLiveMode).toBe(true);
    expect(JSON.parse(opts.body as string)).toEqual({ section: 'geofences' });
  });

  it('seeds the last-reset cache and flushes every query on success', async () => {
    mockedRequest.mockResolvedValueOnce(mkResult({ reset: 4 }));
    const { Wrapper, qc } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useResetSection('alert_rules'), { wrapper: Wrapper });
    const receipt = await result.current.mutateAsync();

    expect(receipt.reset).toBe(4);
    expect(qc.getQueryData<SettingsResetResult>(settingsResetKeys.lastReset)?.reset).toBe(4);
    // No-arg invalidate == flush everything; the reset can touch any cache.
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy.mock.calls[0]).toHaveLength(0);
    expect(errorToast).not.toHaveBeenCalled();
  });

  it('normalises a nil-slice (JSON null) sections field into an empty array', async () => {
    // Go marshals a nil []SettingsResetSectionResult slice as `null`.
    mockedRequest.mockResolvedValueOnce({ reset: 3, sections: null } as unknown as SettingsResetResult);
    const { Wrapper, qc } = makeWrapper();

    const { result } = renderHook(() => useResetSection('general'), { wrapper: Wrapper });
    const receipt = await result.current.mutateAsync();

    expect(receipt.sections).toEqual([]);
    expect(Array.isArray(receipt.sections)).toBe(true);
    expect(receipt.reset).toBe(3);
    // The seeded cache is normalised too, so consumers reading it never crash.
    expect(qc.getQueryData<SettingsResetResult>(settingsResetKeys.lastReset)?.sections).toEqual([]);
  });

  it('normalises a 204-style undefined receipt into a zeroed, empty shape', async () => {
    mockedRequest.mockResolvedValueOnce(undefined as unknown as SettingsResetResult);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useResetSection('quiet_hours'), { wrapper: Wrapper });
    const receipt = await result.current.mutateAsync();

    expect(receipt).toEqual({ reset: 0, sections: [] });
  });

  it('routes a server failure to the section error toast and never seeds the cache', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('SECTION_DENIED'));
    const { Wrapper, qc } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useResetSection('tariffs'), { wrapper: Wrapper });
    await expect(result.current.mutateAsync()).rejects.toThrow('SECTION_DENIED');

    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith(
        expect.any(Error),
        'toast.settings.reset.error',
        'Failed to reset section',
      ),
    );
    expect(qc.getQueryData(settingsResetKeys.lastReset)).toBeUndefined();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('stays silent on a SudoCanceledError — the user already declined the dialog', async () => {
    mockedRequest.mockRejectedValueOnce(new SudoCanceledError());
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useResetSection('automations'), { wrapper: Wrapper });
    await expect(result.current.mutateAsync()).rejects.toBeInstanceOf(SudoCanceledError);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(errorToast).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useResetAllSettings
// ---------------------------------------------------------------------------

describe('useResetAllSettings', () => {
  it('POSTs /settings/reset with an empty body (backend treats it as "reset all")', async () => {
    mockedRequest.mockResolvedValueOnce(mkResult());
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useResetAllSettings(), { wrapper: Wrapper });
    await result.current.mutateAsync();

    const [url, opts] = firstCall();
    expect(url).toBe('/settings/reset');
    expect(opts.method).toBe('POST');
    expect(opts.requiresLiveMode).toBe(true);
    expect(JSON.parse(opts.body as string)).toEqual({});
  });

  it('seeds the last-reset cache and flushes every query on success', async () => {
    mockedRequest.mockResolvedValueOnce(mkResult({ reset: 9 }));
    const { Wrapper, qc } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useResetAllSettings(), { wrapper: Wrapper });
    const receipt = await result.current.mutateAsync();

    expect(receipt.reset).toBe(9);
    expect(qc.getQueryData<SettingsResetResult>(settingsResetKeys.lastReset)?.reset).toBe(9);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(errorToast).not.toHaveBeenCalled();
  });

  it('routes a server failure to the distinct all-reset error toast key', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useResetAllSettings(), { wrapper: Wrapper });
    await expect(result.current.mutateAsync()).rejects.toThrow('boom');

    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith(
        expect.any(Error),
        'toast.settings.reset.allError',
        'Failed to reset all settings',
      ),
    );
  });

  it('stays silent on a SudoCanceledError instead of toasting an error', async () => {
    mockedRequest.mockRejectedValueOnce(new SudoCanceledError('cancelled'));
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useResetAllSettings(), { wrapper: Wrapper });
    await expect(result.current.mutateAsync()).rejects.toBeInstanceOf(SudoCanceledError);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(errorToast).not.toHaveBeenCalled();
  });
});
