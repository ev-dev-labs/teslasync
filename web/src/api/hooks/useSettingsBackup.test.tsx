// useSettingsBackup hook-layer tests.
//
// useSettingsBackup.ts is the settings export/import TanStack Query
// surface backing <SettingsExportImport>: an export mutation, a
// browser-side blob-download helper, and the dry-run / apply import
// mutations. These tests exercise the contract each export exposes —
// the exact request path (no /api/v1 prefix), HTTP method, request
// body (dry_run flag + bundle), query-cache writes under
// settingsBackupKeys, and the i18n-keyed error toast on every failure
// path — plus the download helper's blob content, filename fallback,
// and DOM lifecycle, without standing up the whole settings page.
//
// Sibling-of-source location is mandatory: the elevation gate matches
// `api/hooks/useSettingsBackup` as a contiguous path substring, which a
// __tests__/ subdir would interrupt.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The source toasts through useMutationToast; swap it for hoisted spies
// so we can assert the exact i18n key + fallback each hook emits on
// error without standing up ToastProvider + react-i18next.
const { errorSpy, successSpy } = vi.hoisted(() => ({
  errorSpy: vi.fn(),
  successSpy: vi.fn(),
}));

vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ error: errorSpy, success: successSpy }),
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return {
    ...actual,
    request: vi.fn(),
  };
});

import { request } from '@/api/client';
import {
  settingsBackupKeys,
  useExportSettings,
  downloadSettingsBundle,
  useDryRunImport,
  useApplyImport,
} from './useSettingsBackup';
import {
  defaultExportFilename,
  type SettingsBundle,
  type SettingsImportResult,
} from '@/lib/settingsImportSchema';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

const DEFAULT_FILENAME_RE = /^teslasync-settings-\d{8}\.json$/;

const bundle: SettingsBundle = {
  schema_version: 1,
  exported_at: '2024-01-01T00:00:00Z',
  sections: {
    settings: { unit_of_length: 'km' },
    alert_rules: [{ name: 'Low battery', signal_name: 'battery_level' }],
  },
};

const dryRunResult: SettingsImportResult = {
  dry_run: true,
  sections: {
    settings: { added: 0, updated: 1, skipped: 0 },
    alert_rules: { added: 1, updated: 0, skipped: 0 },
  },
};

/**
 * Fresh QueryClient + provider wrapper per test. Returned together so a
 * test can assert what a mutation's onSuccess wrote into the cache.
 */
function setup() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { qc, wrapper };
}

beforeEach(() => {
  mockedRequest.mockReset();
  errorSpy.mockReset();
  successSpy.mockReset();
});

describe('settingsBackupKeys', () => {
  it('exposes stable, namespaced query-key tuples', () => {
    expect(settingsBackupKeys.root).toEqual(['settings', 'backup']);
    expect(settingsBackupKeys.lastExport).toEqual(['settings', 'backup', 'last-export']);
    expect(settingsBackupKeys.lastImport).toEqual(['settings', 'backup', 'last-import']);
  });

  it('scopes the export and import keys under the shared root and keeps them distinct', () => {
    expect(settingsBackupKeys.lastExport.slice(0, 2)).toEqual(settingsBackupKeys.root);
    expect(settingsBackupKeys.lastImport.slice(0, 2)).toEqual(settingsBackupKeys.root);
    expect(settingsBackupKeys.lastExport).not.toEqual(settingsBackupKeys.lastImport);
  });
});

describe('useExportSettings', () => {
  it('GETs /settings/export and caches the bundle under lastExport', async () => {
    const { qc, wrapper } = setup();
    mockedRequest.mockResolvedValueOnce(bundle);

    const { result } = renderHook(() => useExportSettings(), { wrapper });
    const returned = await result.current.mutateAsync();

    expect(returned).toEqual(bundle);
    expect(mockedRequest).toHaveBeenCalledWith('/settings/export', { method: 'GET' });
    expect(qc.getQueryData(settingsBackupKeys.lastExport)).toEqual(bundle);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('surfaces failures, toasts the export error, and leaves the cache empty', async () => {
    const { qc, wrapper } = setup();
    mockedRequest.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useExportSettings(), { wrapper });
    await expect(result.current.mutateAsync()).rejects.toThrow('boom');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.settings.export.error',
      'Failed to export settings',
    );
    expect(qc.getQueryData(settingsBackupKeys.lastExport)).toBeUndefined();
  });
});

describe('downloadSettingsBundle', () => {
  let createObjSpy: ReturnType<typeof vi.spyOn>;
  let revokeSpy: ReturnType<typeof vi.spyOn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // jsdom doesn't implement the object-URL API — install no-op stand-ins
    // so the spies below have something to wrap.
    if (typeof URL.createObjectURL !== 'function') {
      Object.assign(URL, {
        createObjectURL: () => 'blob:mock',
        revokeObjectURL: () => undefined,
      });
    }
    createObjSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    revokeSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);
    // Prevent jsdom's "navigation not implemented" noise from the synthetic
    // click while still asserting the click fired.
    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    createObjSpy.mockRestore();
    revokeSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it('serialises the bundle to a pretty-printed JSON blob and revokes the URL', async () => {
    downloadSettingsBundle(bundle);

    expect(createObjSpy).toHaveBeenCalledTimes(1);
    const blob = createObjSpy.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/json');
    const text = await blob.text();
    expect(text).toBe(JSON.stringify(bundle, null, 2));
    expect(JSON.parse(text)).toEqual(bundle);

    expect(clickSpy).toHaveBeenCalledTimes(1);
    // Even though the object URL is created before the try, it must be
    // revoked in the finally so the blob is not leaked.
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock');
  });

  it('defaults to a dated filename and detaches the anchor afterwards', () => {
    const createElementSpy = vi.spyOn(document, 'createElement');
    downloadSettingsBundle(bundle);

    const anchor = createElementSpy.mock.results
      .map((r) => r.value)
      .find((el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement);

    expect(anchor).toBeDefined();
    expect(anchor?.download).toMatch(DEFAULT_FILENAME_RE);
    expect(anchor?.download).toBe(defaultExportFilename());
    // Appended, clicked, then removed — never left dangling in the DOM.
    expect(anchor?.isConnected).toBe(false);
    createElementSpy.mockRestore();
  });

  it('uses a caller-supplied filename verbatim', () => {
    const createElementSpy = vi.spyOn(document, 'createElement');
    downloadSettingsBundle(bundle, 'my-backup.json');

    const anchor = createElementSpy.mock.results
      .map((r) => r.value)
      .find((el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement);

    expect(anchor?.download).toBe('my-backup.json');
    createElementSpy.mockRestore();
  });

  it('falls back to the default filename for an empty or whitespace name', () => {
    const createElementSpy = vi.spyOn(document, 'createElement');

    downloadSettingsBundle(bundle, '');
    downloadSettingsBundle(bundle, '   ');

    const anchors = createElementSpy.mock.results
      .map((r) => r.value)
      .filter((el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement);

    expect(anchors).toHaveLength(2);
    for (const anchor of anchors) {
      expect(anchor.download).toMatch(DEFAULT_FILENAME_RE);
      expect(anchor.download).not.toBe('');
    }
    createElementSpy.mockRestore();
  });
});

describe('useDryRunImport', () => {
  it('POSTs /settings/import with dry_run=true and caches the result under lastImport', async () => {
    const { qc, wrapper } = setup();
    mockedRequest.mockResolvedValueOnce(dryRunResult);

    const { result } = renderHook(() => useDryRunImport(), { wrapper });
    const returned = await result.current.mutateAsync({ bundle });

    expect(returned).toEqual(dryRunResult);
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/settings/import');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual({ dry_run: true, bundle });
    expect(qc.getQueryData(settingsBackupKeys.lastImport)).toEqual(dryRunResult);
  });

  it('toasts a dry-run-specific error message on failure', async () => {
    const { wrapper } = setup();
    mockedRequest.mockRejectedValueOnce(new Error('nope'));

    const { result } = renderHook(() => useDryRunImport(), { wrapper });
    await expect(result.current.mutateAsync({ bundle })).rejects.toThrow('nope');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.settings.import.dryRunError',
      'Failed to preview import',
    );
  });
});

describe('useApplyImport', () => {
  it('POSTs /settings/import with dry_run=false and caches the applied result', async () => {
    const { qc, wrapper } = setup();
    const applied: SettingsImportResult = {
      dry_run: false,
      sections: { alert_rules: { added: 1, updated: 0, skipped: 0 } },
    };
    mockedRequest.mockResolvedValueOnce(applied);

    const { result } = renderHook(() => useApplyImport(), { wrapper });
    const returned = await result.current.mutateAsync({ bundle });

    expect(returned).toEqual(applied);
    const options = mockedRequest.mock.calls[0][1];
    const body = JSON.parse(options.body as string);
    expect(options.requiresLiveMode).toBe(true);
    expect(body.dry_run).toBe(false);
    expect(body.bundle).toEqual(bundle);
    expect(qc.getQueryData(settingsBackupKeys.lastImport)).toEqual(applied);
  });

  it('toasts an apply-specific error message on failure', async () => {
    const { wrapper } = setup();
    mockedRequest.mockRejectedValueOnce(new Error('kaboom'));

    const { result } = renderHook(() => useApplyImport(), { wrapper });
    await expect(result.current.mutateAsync({ bundle })).rejects.toThrow('kaboom');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.settings.import.applyError',
      'Failed to apply import',
    );
  });

  it('overwrites a prior dry-run in the shared lastImport cache when applied', async () => {
    const { qc, wrapper } = setup();

    mockedRequest.mockResolvedValueOnce(dryRunResult);
    const dry = renderHook(() => useDryRunImport(), { wrapper });
    await dry.result.current.mutateAsync({ bundle });
    expect(qc.getQueryData(settingsBackupKeys.lastImport)).toEqual(dryRunResult);

    const applied: SettingsImportResult = {
      dry_run: false,
      sections: { settings: { added: 2, updated: 0, skipped: 0 } },
    };
    mockedRequest.mockResolvedValueOnce(applied);
    const ap = renderHook(() => useApplyImport(), { wrapper });
    await ap.result.current.mutateAsync({ bundle });

    expect(qc.getQueryData(settingsBackupKeys.lastImport)).toEqual(applied);
  });
});
