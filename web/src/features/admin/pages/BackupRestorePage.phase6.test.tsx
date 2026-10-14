import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const operational = vi.hoisted(() => ({
  canWrite: true,
  writeBlockReason: null as string | null,
}));

vi.mock('@/hooks/useOperationalMode', () => ({
  useOperationalMode: () => operational,
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (value: string, options?: Record<string, unknown>) =>
    value.replace(/{{(\w+)}}/g, (token, name: string) =>
      options && name in options ? String(options[name]) : token);
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string | Record<string, unknown>, options?: Record<string, unknown>) =>
        typeof fallback === 'string' ? interpolate(fallback, options)
          : typeof fallback?.defaultValue === 'string' ? interpolate(fallback.defaultValue, fallback)
            : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/features/settings/components/SettingsExportImport', () => ({
  SettingsExportImport: () => <div data-testid="portable-settings-seam" />,
}));

import { ApiError, request, type ApiRequestOptions } from '@/api/client';
import { ToastProvider } from '@/components/feedback';
import BackupRestorePage from './BackupRestorePage';

const mockedRequest = vi.mocked(request);
const time = '2026-10-12T12:00:00Z';
const config = {
  id: 1, name: 'Raw config', enabled: false, backup_type: 'incremental',
  frequency_days: 30, max_retention: 100, provider: 'local',
  provider_config: { path: '/raw/backups', extra: ' keep this ' },
  include_tables: ['vehicles', 'drives'], compress: false, encrypt: true,
  created_at: time, updated_at: time,
};
const run = {
  id: 1, config_id: 1, run_type: 'backup', backup_type: 'full',
  status: 'completed', provider: 'local', file_name: 'raw-backup.json',
  file_size: 0, record_count: 42, table_count: 2, checksum: 'abc',
  duration_ms: 12000, created_at: time,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let configs: object[];
let runs: object[];
let verification: unknown;
let preview: unknown;
let write: (path: string, options: ApiRequestOptions) => unknown;
let readRuns: (offset: number) => unknown;
const clients: QueryClient[] = [];

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  clients.push(client);
  const element = () => (
    <MemoryRouter initialEntries={['/backup']}>
      <QueryClientProvider client={client}>
        <ToastProvider><BackupRestorePage /></ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  const rendered = render(element());
  return { ...rendered, client, refreshMode: () => rendered.rerender(element()) };
}

async function loaded() {
  await waitFor(() => {
    const summary = screen.getByTestId('backup-restore-summary');
    expect(summary.querySelector('[data-operational-metric="configs"]')).toHaveAttribute('data-value-state', 'value');
    expect(summary.querySelector('[data-operational-metric="backups"]')).toHaveAttribute('data-value-state', 'value');
  });
}

async function createForm() {
  fireEvent.click(screen.getAllByRole('button', { name: 'New config' })[0]);
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: ' Raw new name ' } });
  return dialog;
}

function writes() {
  return mockedRequest.mock.calls.filter(([, options]) => options?.method && options.method !== 'GET');
}

beforeEach(() => {
  vi.clearAllMocks();
  onlineManager.setOnline(true);
  operational.canWrite = true;
  operational.writeBlockReason = null;
  configs = [config];
  runs = [run];
  verification = { verified: true };
  preview = { tables: [{ name: 'vehicles', rows: 42 }], checksum_verified: true, metadata: null };
  write = () => ({ ...config, id: 2 });
  readRuns = () => runs;
  mockedRequest.mockImplementation(async (path, options) => {
    if (path === '/backup/configs' && !options?.method) return configs as never;
    if (path.startsWith('/backup/runs') && !options?.method && !path.endsWith('/preview')) {
      return await readRuns(Number(new URLSearchParams(path.split('?')[1]).get('offset') ?? 0)) as never;
    }
    if (path.endsWith('/preview')) return await preview as never;
    if (path.endsWith('/verify')) return verification as never;
    if (options?.method && options.requiresLiveMode === true) return await write(path, options) as never;
    throw new Error(`Unmocked or unguarded request: ${path}`);
  });
});

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

describe('phase6 backup write and form contracts', () => {
  it.each(['historical', 'offline'])('blocks %s writes with the existing reason while preserving inspection', async (mode) => {
    operational.canWrite = false;
    operational.writeBlockReason = `${mode} write blocked`;
    mount();
    await loaded();
    expect(screen.getByText(operational.writeBlockReason)).toBeInTheDocument();
    for (const name of ['Quick backup', 'Trigger now', 'Delete', 'Verify']) {
      for (const button of screen.getAllByRole('button', { name })) expect(button).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled();
    const dialog = await createForm();
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(writes()).toHaveLength(0);
  });

  it.each([
    ['local', ['Path']],
    ['s3', ['Bucket', 'Region', 'Access key', 'Secret key']],
    ['azure', ['Account name', 'Account key', 'Container name']],
    ['gcs', ['Bucket', 'Credentials JSON']],
  ])('validates every required %s field without altering raw strings', async (provider, fields) => {
    mount();
    await loaded();
    const dialog = await createForm();
    fireEvent.change(within(dialog).getByLabelText('Provider'), { target: { value: provider } });
    const save = within(dialog).getByRole('button', { name: 'Create' });
    expect(save).toBeDisabled();
    for (const label of fields) {
      const input = within(dialog).getByLabelText(label);
      expect(input).toBeRequired();
      fireEvent.change(input, { target: { value: '   ' } });
      expect(save).toBeDisabled();
      fireEvent.change(input, { target: { value: ` raw ${label} ` } });
    }
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(writes()).toHaveLength(1));
    const body = JSON.parse(String(writes()[0][1]?.body)) as {
      name: string; provider: string; provider_config: Record<string, string>;
    };
    expect(body.name).toBe(' Raw new name ');
    expect(body.provider).toBe(provider);
    expect(Object.values(body.provider_config)).toEqual(fields.map((label) => ` raw ${label} `));
    expect(writes()[0][1]).toMatchObject({ requiresLiveMode: true, method: 'POST' });
  });

  it.each([
    ['Frequency (days)', ''], ['Frequency (days)', '0'], ['Frequency (days)', '-1'],
    ['Frequency (days)', '1.5'], ['Frequency (days)', '31'], ['Frequency (days)', '1e309'],
    ['Max retention', ''], ['Max retention', '0'], ['Max retention', '-1'],
    ['Max retention', '1.5'], ['Max retention', '101'], ['Max retention', '1e309'],
  ])('rejects invalid %s=%s instead of clamping or posting', async (label, value) => {
    mount();
    await loaded();
    const dialog = await createForm();
    const field = within(dialog).getByLabelText(label);
    fireEvent.change(field, { target: { value } });
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(writes()).toHaveLength(0);
    fireEvent.change(field, { target: { value: '1' } });
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeEnabled();
  });

  it('edits at the real inclusive integer bounds and preserves all hidden configuration values', async () => {
    mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Frequency (days)')).toHaveValue(30);
    expect(within(dialog).getByLabelText('Max retention')).toHaveValue(100);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/backup/configs/1');
    expect(writes()[0][1]).toMatchObject({ method: 'PUT', requiresLiveMode: true });
    expect(JSON.parse(String(writes()[0][1]?.body))).toMatchObject({
      name: config.name, enabled: false, backup_type: 'incremental',
      frequency_days: 30, max_retention: 100, provider_config: config.provider_config,
      include_tables: config.include_tables, compress: false, encrypt: true,
    });
  });

  it.each(['create', 'update'])('binds deferred %s completion to its original modal session', async (kind) => {
    const pending = deferred<object>();
    write = () => pending.promise;
    mount();
    await loaded();
    let dialog: HTMLElement;
    if (kind === 'create') dialog = await createForm();
    else {
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      dialog = await screen.findByRole('dialog');
    }
    const submit = within(dialog).getByRole('button', { name: kind === 'create' ? 'Create' : 'Save changes' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(writes()).toHaveLength(1));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    const newer = await createForm();
    fireEvent.change(within(newer).getByLabelText('Name'), { target: { value: 'Do not discard B' } });
    await act(async () => { pending.resolve(config); await pending.promise; });
    expect(await screen.findByText(kind === 'create' ? 'Config created' : 'Config updated')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByLabelText('Name')).toHaveValue('Do not discard B');
  });

  it('keeps the draft after save failure and supports a deliberate retry', async () => {
    write = () => Promise.reject(new Error('synthetic save failure'));
    mount();
    await loaded();
    const dialog = await createForm();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Failed to create config')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Name')).toHaveValue(' Raw new name ');
    write = () => config;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Config created')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(writes()).toHaveLength(2);
  });

  it('uses live-only transport for trigger and confirmed delete', async () => {
    mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Trigger now' }));
    expect(await screen.findByText('Backup triggered')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(config.name);
    expect(writes()).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Config deleted')).toBeInTheDocument();
    expect(writes().map(([path]) => path)).toEqual(['/backup/configs/1/trigger', '/backup/configs/1']);
    for (const [, options] of writes()) expect(options?.requiresLiveMode).toBe(true);
  });

  it('disables an already-open delete confirmation when live mode is lost', async () => {
    const page = mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    operational.canWrite = false;
    operational.writeBlockReason = 'Return to live mode';
    page.refreshMode();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(dialog).toHaveTextContent('Return to live mode');
    expect(writes()).toHaveLength(0);
  });

  it('guards both quick-backup entry points synchronously while pending, then permits retry', async () => {
    runs = [];
    const pending = deferred<object>();
    write = () => pending.promise;
    mount();
    await loaded();
    const buttons = screen.getAllByRole('button', { name: 'Quick backup' });
    expect(buttons).toHaveLength(2);
    act(() => { fireEvent.click(buttons[1]); fireEvent.click(buttons[1]); fireEvent.click(buttons[0]); });
    await waitFor(() => expect(writes()).toHaveLength(1));
    for (const button of screen.getAllByRole('button', { name: 'Quick backup' })) expect(button).toBeDisabled();
    await act(async () => { pending.reject(new Error('synthetic quick failure')); await pending.promise.catch(() => undefined); });
    expect(await screen.findByText('Quick backup failed')).toBeInTheDocument();
    write = () => undefined;
    fireEvent.click(screen.getAllByRole('button', { name: 'Quick backup' })[1]);
    expect(await screen.findByText('Quick backup started')).toBeInTheDocument();
    expect(writes()).toHaveLength(2);
  });
});

describe('phase6 backup integrity and bounded history', () => {
  it.each([
    null, undefined, {}, { verified: false },
    { verified: false, error: 'backup has no file path or checksum' },
  ])('keeps unavailable verification evidence unknown: %j', async (response) => {
    verification = response;
    mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('Checksum mismatch')).not.toBeInTheDocument();
    expect(screen.queryByText('Checksum verified')).not.toBeInTheDocument();
    expect(writes()[0][1]).toMatchObject({ method: 'POST', requiresLiveMode: true });
  });

  it.each([
    [{ verified: true }, 'Checksum verified'],
    [{ verified: false, error: 'checksum mismatch: expected abc, got def' }, 'Checksum mismatch'],
    [{ verified: false, error: 'download for verify: storage unavailable' }, 'Verification failed'],
  ])('distinguishes real verification outcomes: %j', async (response, label) => {
    verification = response;
    mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText(label)).toBeInTheDocument();
    if (label !== 'Checksum mismatch') expect(screen.queryByText('Checksum mismatch')).not.toBeInTheDocument();
  });

  it('keeps an absent preview checksum neutral while retaining the manifest and close action', async () => {
    preview = { tables: [{ name: 'vehicles', rows: 42 }], checksum_verified: false };
    mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Unknown');
    expect(dialog).toHaveTextContent('vehicles');
    expect(dialog).toHaveTextContent('42');
    expect(dialog).not.toHaveTextContent('Checksum verification failed');
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close', exact: true }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it.each([null, ''])('keeps failed rows without diagnostic text visible: %j', async (message) => {
    runs = [{ ...run, status: 'failed', error_message: message }];
    mount();
    await loaded();
    expect(screen.queryByText('No recent backup failures.')).not.toBeInTheDocument();
    expect(screen.getByText(/unknown error/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument();
  });

  it('navigates existing server offsets without inventing totals and returns from an empty last batch', async () => {
    const first = Array.from({ length: 50 }, (_, index) => ({ ...run, id: index + 1, file_name: `file-${index + 1}` }));
    readRuns = (offset) => offset === 0 ? first : offset === 50 ? [{ ...run, id: 51, file_name: 'older-file-51' }] : [];
    mount();
    await loaded();
    const next = screen.getByRole('button', { name: 'Next', exact: true });
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(await screen.findByText('older-file-51')).toBeInTheDocument();
    expect(mockedRequest).toHaveBeenCalledWith('/backup/runs?limit=50&offset=50', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous', exact: true }));
    expect(await screen.findByText('file-1')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next', exact: true })).toBeEnabled());
    readRuns = (offset) => offset === 0 ? first : [];
    fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    expect(await screen.findByText('No data available')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous', exact: true })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  });

  it('preserves all five sections, six metrics and retained rows during refresh failure', async () => {
    const { client } = mount();
    await loaded();
    expect(screen.getByTestId('backup-restore-summary').querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    for (const label of ['Backup configurations', 'Reliability & storage', 'Backup history']) {
      expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
    }
    expect(screen.getByTestId('portable-settings-seam')).toBeInTheDocument();
    readRuns = () => Promise.reject(new ApiError(503, 'Synthetic unavailable history'));
    await act(async () => { await client.invalidateQueries({ queryKey: ['backup-runs'] }); });
    expect(screen.getByText('raw-backup.json')).toBeInTheDocument();
    expect(screen.getByText('Raw config')).toBeInTheDocument();
    expect(screen.getByTestId('portable-settings-seam')).toBeInTheDocument();
  });
});
