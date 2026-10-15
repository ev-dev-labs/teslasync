import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SETTINGS_BUNDLE_SCHEMA_VERSION,
  SETTINGS_BUNDLE_SECTION_KEYS,
  validateSettingsBundle,
  type SettingsBundle,
  type SettingsBundleValidationIssue,
  type SettingsImportResult,
} from '@/lib/settingsImportSchema';

const { requestMock, successMock, errorMock, translations, translateMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  successMock: vi.fn(),
  errorMock: vi.fn(),
  translations: new Map<string, string>(),
  translateMock: vi.fn((key: string, fallbackOrOptions?: unknown, maybeOptions?: unknown) => {
    const options = (typeof fallbackOrOptions === 'object' && fallbackOrOptions !== null
      ? fallbackOrOptions : maybeOptions) as Record<string, unknown> | undefined;
    const fallback = typeof fallbackOrOptions === 'string'
      ? fallbackOrOptions : String(options?.defaultValue ?? key);
    return (translations.get(key) ?? fallback).replace(
      /\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? `{{${name}}}`),
    );
  }),
}));

vi.mock('@/api/client', async () => ({
  ...await vi.importActual<typeof import('@/api/client')>('@/api/client'),
  request: requestMock,
}));

vi.mock('react-i18next', async () => ({
  ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
  useTranslation: () => ({
    t: translateMock,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/components/feedback/Toast', async () => {
  const actual = await vi.importActual<typeof import('@/components/feedback/Toast')>(
    '@/components/feedback/Toast',
  );
  const toast = { success: successMock, error: errorMock, warning: vi.fn() };
  return { ...actual, useToast: () => toast, useOptionalToast: () => toast };
});

import { SudoCanceledError } from '@/api/client';
import { SettingsExportImport } from './SettingsExportImport';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function bundle(name = 'A'): SettingsBundle {
  return {
    schema_version: SETTINGS_BUNDLE_SCHEMA_VERSION,
    exported_at: '2026-10-14T00:00:00Z',
    sections: {
      settings: { theme: name },
      alert_rules: [{ name }],
      geofences: [{ name }],
      quiet_hours: [{ timezone: 'UTC' }],
    },
  };
}

function result(count: number, dryRun = true): SettingsImportResult {
  return { dry_run: dryRun, sections: { alert_rules: { added: count, updated: 0, skipped: 0 } } };
}

function file(name: string, value: unknown = bundle(name), read?: Promise<string>) {
  const next = new File([JSON.stringify(value)], `${name}.json`, { type: 'application/json' });
  Object.defineProperty(next, 'text', {
    value: vi.fn(() => read ?? Promise.resolve(JSON.stringify(value))), configurable: true,
  });
  return next;
}

function pick(next: File) {
  fireEvent.change(screen.getByTestId('settings-import-file-input'), { target: { files: [next] } });
}

function drop(next: File) {
  fireEvent.drop(screen.getByTestId('settings-import-dropzone'), { dataTransfer: { files: [next] } });
}

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}><SettingsExportImport /></QueryClientProvider>);
}

async function preview(name: string, count = 1) {
  requestMock.mockResolvedValueOnce(result(count));
  pick(file(name));
  await screen.findByTestId('settings-import-preview');
}

async function settle<T>(operation: ReturnType<typeof deferred<T>>, value: T) {
  await act(async () => { operation.resolve(value); await operation.promise; });
}

beforeEach(() => {
  requestMock.mockReset();
  successMock.mockReset();
  errorMock.mockReset();
  translateMock.mockClear();
  translations.clear();
});

afterEach(cleanup);

describe('phase6 import generation ownership', () => {
  it('ignores an older file read after a newer drop and applies exactly the displayed bundle', async () => {
    const readingA = deferred<string>();
    requestMock.mockResolvedValueOnce(result(7)).mockResolvedValueOnce(result(7, false));
    mount();
    drop(file('A', bundle('A'), readingA.promise));
    drop(file('B'));
    await screen.findByTestId('settings-import-preview');
    await settle(readingA, JSON.stringify(bundle('A')));
    expect(screen.getByTestId('settings-import-preview')).toHaveTextContent('B.json');
    expect(screen.getByTestId('settings-import-apply')).toHaveTextContent('Apply 7 change(s)');
    fireEvent.click(screen.getByTestId('settings-import-apply'));
    await screen.findByTestId('settings-import-applied');
    const bodies = requestMock.mock.calls.map(([, options]) => JSON.parse(options.body as string));
    expect(bodies).toEqual([
      { dry_run: true, bundle: bundle('B') },
      { dry_run: false, bundle: bundle('B') },
    ]);
    expect(requestMock).toHaveBeenLastCalledWith('/settings/import', expect.objectContaining({
      method: 'POST', requiresLiveMode: true,
    }));
  });

  it('ignores an older dry-run success resolved after the newer preview', async () => {
    const oldPreview = deferred<SettingsImportResult>();
    const newPreview = deferred<SettingsImportResult>();
    requestMock.mockReturnValueOnce(oldPreview.promise).mockReturnValueOnce(newPreview.promise);
    mount();
    drop(file('A'));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    drop(file('B'));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    await settle(newPreview, result(4));
    await screen.findByTestId('settings-import-preview');
    await settle(oldPreview, result(99));
    expect(screen.getByTestId('settings-import-preview')).toHaveTextContent('B.json');
    expect(screen.getByTestId('settings-import-apply')).toHaveTextContent('Apply 4 change(s)');
    expect(screen.queryByTestId('settings-import-error')).not.toBeInTheDocument();
    requestMock.mockResolvedValueOnce(result(4, false));
    fireEvent.click(screen.getByTestId('settings-import-apply'));
    await screen.findByTestId('settings-import-applied');
    expect(JSON.parse(requestMock.mock.lastCall?.[1].body as string))
      .toEqual({ dry_run: false, bundle: bundle('B') });
  });

  it('ignores an older dry-run rejection without erasing the newer preview', async () => {
    const oldPreview = deferred<SettingsImportResult>();
    requestMock.mockReturnValueOnce(oldPreview.promise).mockResolvedValueOnce(result(3));
    mount();
    pick(file('A'));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    drop(file('B'));
    await screen.findByTestId('settings-import-preview');
    await act(async () => { oldPreview.reject(new Error('old preview')); });
    expect(screen.getByTestId('settings-import-preview')).toHaveTextContent('B.json');
    expect(screen.queryByTestId('settings-import-error')).not.toBeInTheDocument();
  });

  it('ignores an older read failure after a newer file has finished', async () => {
    const oldRead = deferred<string>();
    requestMock.mockResolvedValueOnce(result(2));
    mount();
    drop(file('A', bundle('A'), oldRead.promise));
    drop(file('B'));
    await screen.findByTestId('settings-import-preview');
    await act(async () => { oldRead.reject(new Error('old file unreadable')); });
    expect(screen.getByTestId('settings-import-preview')).toHaveTextContent('B.json');
    expect(screen.queryByTestId('settings-import-error')).not.toBeInTheDocument();
  });

  it('does not parse or preview an older malformed read after a newer selection', async () => {
    const oldRead = deferred<string>();
    requestMock.mockResolvedValueOnce(result(2));
    mount();
    pick(file('A', bundle('A'), oldRead.promise));
    pick(file('B'));
    await screen.findByTestId('settings-import-preview');
    await settle(oldRead, '{invalid');
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('settings-import-error')).not.toBeInTheDocument();
  });

  it('Change file invalidates an in-flight apply completion and its success toast', async () => {
    const oldApply = deferred<SettingsImportResult>();
    mount();
    await preview('A');
    requestMock.mockReturnValueOnce(oldApply.promise);
    fireEvent.click(screen.getByTestId('settings-import-apply'));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Change file' }));
    await preview('B', 5);
    expect(screen.getByTestId('settings-import-apply')).toBeEnabled();
    await settle(oldApply, result(1, false));
    expect(screen.queryByTestId('settings-import-applied')).not.toBeInTheDocument();
    expect(screen.getByTestId('settings-import-preview')).toHaveTextContent('B.json');
    expect(successMock).not.toHaveBeenCalled();
  });

  it('keeps a new apply busy until its own completion even when the older apply completes', async () => {
    const oldApply = deferred<SettingsImportResult>();
    const newApply = deferred<SettingsImportResult>();
    mount();
    await preview('A');
    requestMock.mockReturnValueOnce(oldApply.promise);
    fireEvent.click(screen.getByTestId('settings-import-apply'));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Change file' }));
    await preview('B', 5);
    requestMock.mockReturnValueOnce(newApply.promise);
    fireEvent.click(screen.getByTestId('settings-import-apply'));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(4));
    await settle(oldApply, result(99, false));
    expect(screen.getByTestId('settings-import-apply')).toBeDisabled();
    expect(screen.getByTestId('settings-import-preview')).toHaveTextContent('B.json');
    await settle(newApply, result(5, false));
    await screen.findByTestId('settings-import-applied');
    expect(successMock).toHaveBeenCalledTimes(1);
  });

  it.each([new Error('old apply'), new SudoCanceledError('old sudo cancelled')])(
    'ignores a superseded apply rejection without changing the newer session: %s',
    async (error) => {
      const oldApply = deferred<SettingsImportResult>();
      mount();
      await preview('A');
      requestMock.mockReturnValueOnce(oldApply.promise);
      fireEvent.click(screen.getByTestId('settings-import-apply'));
      await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
      fireEvent.click(screen.getByRole('button', { name: 'Change file' }));
      await preview('B', 3);
      await act(async () => { oldApply.reject(error); });
      expect(screen.getByTestId('settings-import-preview')).toHaveTextContent('B.json');
      expect(screen.getByTestId('settings-import-apply')).toBeEnabled();
      expect(screen.queryByTestId('settings-import-applied')).not.toBeInTheDocument();
    },
  );

  it('suppresses duplicate Apply clicks for one preview', async () => {
    const applying = deferred<SettingsImportResult>();
    mount();
    await preview('A');
    requestMock.mockReturnValueOnce(applying.promise);
    const button = screen.getByTestId('settings-import-apply');
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    await settle(applying, result(1, false));
    await screen.findByTestId('settings-import-applied');
  });

  it('cancel invalidates the old preview and keeps the idle intake', async () => {
    mount();
    await preview('A');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('settings-import-dropzone')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-import-preview')).not.toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('unmount invalidates the in-flight apply and prevents a component success toast', async () => {
    const applying = deferred<SettingsImportResult>();
    const view = mount();
    await preview('A');
    requestMock.mockReturnValueOnce(applying.promise);
    fireEvent.click(screen.getByTestId('settings-import-apply'));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    view.unmount();
    await settle(applying, result(1, false));
    expect(successMock).not.toHaveBeenCalled();
  });
});

describe('phase6 preserved import recovery and sections', () => {
  it.each([
    new SudoCanceledError('User cancelled'),
    new Error('temporary apply failure'),
  ])('preserves the preview and permits retry after %s', async (error) => {
    mount();
    await preview('A');
    requestMock.mockRejectedValueOnce(error).mockResolvedValueOnce(result(1, false));
    fireEvent.click(screen.getByTestId('settings-import-apply'));
    await waitFor(() => expect(screen.getByTestId('settings-import-apply')).toBeEnabled());
    expect(screen.getByTestId('settings-import-preview')).toHaveTextContent('A.json');
    expect(screen.queryByTestId('settings-import-applied')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('settings-import-apply'));
    await screen.findByTestId('settings-import-applied');
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it('recovers from a current preview failure with another file', async () => {
    requestMock.mockRejectedValueOnce(new Error('preview unavailable'));
    mount();
    pick(file('A'));
    expect(await screen.findByTestId('settings-import-error')).toHaveTextContent('preview unavailable');
    await preview('B');
    expect(screen.getByTestId('settings-import-preview')).toHaveTextContent('B.json');
    expect(screen.queryByTestId('settings-import-error')).not.toBeInTheDocument();
  });

  it('retains export/import headings, four preview rows, no-change state and file reset', async () => {
    mount();
    expect(screen.getByText('Export settings')).toBeInTheDocument();
    expect(screen.getByText('Import settings')).toBeInTheDocument();
    await preview('A', 0);
    expect(screen.getByTestId('settings-import-section-list').children).toHaveLength(4);
    expect(screen.getByTestId('settings-import-apply')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Change file' }));
    expect(screen.getByTestId('settings-import-file-input')).toHaveValue('');
    expect(SETTINGS_BUNDLE_SECTION_KEYS).toEqual(['settings', 'alert_rules', 'geofences', 'quiet_hours']);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('preserves read, JSON and size rejections without issuing requests', async () => {
    mount();
    const unreadable = file('unreadable');
    Object.defineProperty(unreadable, 'text', { value: () => Promise.reject(new Error('read failed')), configurable: true });
    pick(unreadable);
    expect(await screen.findByTestId('settings-import-error')).toHaveTextContent('Failed to read');
    const malformed = file('malformed', {}, Promise.resolve('{invalid'));
    pick(malformed);
    await waitFor(() => expect(screen.getByTestId('settings-import-error')).toHaveTextContent('File is not valid JSON'));
    const oversized = file('large');
    Object.defineProperty(oversized, 'size', { value: (1 << 20) + 1 });
    pick(oversized);
    await waitFor(() => expect(screen.getByTestId('settings-import-error')).toHaveTextContent('File is too large'));
    expect(requestMock).not.toHaveBeenCalled();
  });
});

describe('phase6 validator localization contract (catalog mapping still external)', () => {
  const cases: Array<[unknown, SettingsBundleValidationIssue]> = [
    [null, { code: 'bundle_object', values: {}, message: 'Bundle must be a JSON object' }],
    [{ ...bundle(), schema_version: 1.5 }, { code: 'schema_version_positive_integer', values: {}, message: 'schema_version must be a positive integer' }],
    [{ ...bundle(), schema_version: 99 }, { code: 'schema_version_unsupported', values: { version: 99, max: 1 }, message: 'schema_version 99 is newer than this build supports (max 1)' }],
    [{ ...bundle(), exported_at: '' }, { code: 'exported_at_nonempty', values: {}, message: 'exported_at must be a non-empty ISO-8601 string' }],
    [{ ...bundle(), sections: null }, { code: 'sections_object', values: {}, message: 'sections must be a JSON object' }],
    [{ ...bundle(), sections: { bogus: [] } }, { code: 'unknown_section', values: { section: 'bogus' }, message: 'Unknown section "bogus"' }],
    [{ ...bundle(), sections: { settings: 'x' } }, { code: 'settings_object', values: {}, message: 'sections.settings must be an object' }],
    ...(['alert_rules', 'geofences', 'quiet_hours'] as const).map((section): [unknown, SettingsBundleValidationIssue] => [
      { ...bundle(), sections: { [section]: 'x' } },
      { code: 'section_array', values: { section }, message: `sections.${section} must be an array` },
    ]),
  ];

  it.each(cases)('preserves the existing error and exposes the exact issue for %j', (input, issue) => {
    expect(validateSettingsBundle(input)).toBe(issue.message);
    const localize = vi.fn(() => 'diagnostic localisé');
    expect(validateSettingsBundle(input, localize)).toBe('diagnostic localisé');
    expect(localize).toHaveBeenCalledExactlyOnceWith(issue);
  });

  it('passes raw interpolation values without escaping or changing user data', () => {
    const section = 'nom "inconnu"';
    const localize = (issue: SettingsBundleValidationIssue) => `Section inconnue : ${issue.values.section}`;
    expect(validateSettingsBundle({ ...bundle(), sections: { [section]: [] } }, localize))
      .toBe(`Section inconnue : ${section}`);
  });

  it('localizes the existing wrapper and retains stable UI validation identity without guessed keys', async () => {
    translations.set('backup.import.errorPreview', 'Impossible de prévisualiser l’import.');
    mount();
    pick(file('future', { ...bundle(), schema_version: 99 }));
    const error = await screen.findByTestId('settings-import-error');
    expect(error).toHaveAttribute('data-validation-code', 'schema_version_unsupported');
    expect(error).toHaveTextContent('Impossible de prévisualiser l’import.');
    expect(error).toHaveTextContent('schema_version 99');
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('preserves full and partial bundles and leaves the localizer unused on success', () => {
    const localize = vi.fn(() => 'unused');
    expect(validateSettingsBundle(bundle(), localize)).toEqual(bundle());
    expect(validateSettingsBundle({ ...bundle(), sections: { alert_rules: [] } }, localize)).toEqual({
      ...bundle(), sections: { settings: undefined, alert_rules: [], geofences: undefined, quiet_hours: undefined },
    });
    expect(localize).not.toHaveBeenCalled();
  });
});
