/**
 * BackupRestorePage contract tests.
 *
 * The page has a single default export (the page component) that fans out
 * into two queries (`/backup/configs`, `/backup/runs`) plus six mutations
 * (create / update / delete / trigger / quick / verify) and a preview fetch.
 *
 * Covered facets:
 *   1. KPI band renders derived stats (totals, success-rate, size).
 *   2. Configurations table renders rows + the "Disabled" badge branch.
 *   3. Reliability panel derives success-rate, per-provider storage, and the
 *      recent-errors list from the runs.
 *   4. History table renders run rows and only exposes the download / verify /
 *      preview actions on *completed* runs.
 *   5. Empty states render for both data sources.
 *   6. A failed configs query surfaces the QueryError recovery UI.
 *   7. Quick Backup fires POST /backup/quick and toasts.
 *   8. Create flow: the Create button is gated on a non-empty name, submits the
 *      form body, closes the modal and toasts.
 *   9. Switching provider swaps the dynamic provider-credential fields.
 *  10. Edit fires PUT, Delete confirms then fires DELETE, Trigger fires POST.
 *  11. Download opens the canonical apiUrl() download URL (regression guard for
 *      the /api/v1 prefix build).
 *  12. Verify tolerates a 204/empty body (regression guard for the null-safety
 *      fix) and confirms a verified checksum on a body response.
 *  13. Preview renders the table manifest + checksum status, handles the empty
 *      manifest branch, and toasts on a preview fetch failure.
 *
 * Network is mocked at the `request()` seam; `apiUrl()` is kept real so the
 * download-URL assertion exercises the true prefix-building path. Interactions
 * use `fireEvent` — the established convention in this repo's page tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// Mock only the network seam. Keep `apiUrl` / `ApiError` real so the download
// test asserts the genuine /api/v1 URL builder and error tests use real errors.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

// i18n stub: resolve fallback strings and interpolate {{tokens}}, matching the
// repo convention (see RbacMatrixPage.test.tsx).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (tpl: string, opts?: Record<string, unknown>) =>
    opts
      ? tpl.replace(/{{(\w+)}}/g, (_, name) => (name in opts ? String(opts[name]) : `{{${name}}}`))
      : tpl;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          return interpolate(fallbackOrOpts, opts as Record<string, unknown> | undefined);
        }
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') return interpolate(o.defaultValue, o);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// The settings JSON bundle panel has its own hooks + test; stub it so this
// page test stays focused on the backup surfaces.
vi.mock('@/features/settings/components/SettingsExportImport', () => ({
  SettingsExportImport: () => <div data-testid="settings-export-import" />,
}));

import { ApiError, request } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import BackupRestorePage from './BackupRestorePage';

const mockedRequest = vi.mocked(request);

const MB = 1024 * 1024;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

interface TestConfig {
  id: number;
  name: string;
  enabled: boolean;
  backup_type: string;
  frequency_days: number;
  max_retention: number;
  provider: string;
  provider_config: Record<string, string>;
  compress: boolean;
  encrypt: boolean;
  last_run_at?: string | null;
  next_run_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface TestRun {
  id: number;
  config_id: number | null;
  run_type: string;
  backup_type: string;
  status: string;
  provider: string;
  file_name?: string | null;
  file_path?: string | null;
  file_size: number;
  record_count: number;
  table_count: number;
  checksum?: string | null;
  duration_ms: number;
  error_message?: string | null;
  metadata?: Record<string, unknown>;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
}

interface RestorePreview {
  tables: { name: string; rows: number }[];
  metadata: Record<string, unknown> | null;
  checksum_verified: boolean;
}

function makeConfig(overrides: Partial<TestConfig> = {}): TestConfig {
  return {
    id: 1,
    name: 'Nightly Full',
    enabled: true,
    backup_type: 'full',
    frequency_days: 1,
    max_retention: 7,
    provider: 's3',
    provider_config: { bucket: 'my-bucket', region: 'us-east-1' },
    compress: true,
    encrypt: true,
    last_run_at: iso(3 * 60 * 60 * 1000),
    next_run_at: iso(-21 * 60 * 60 * 1000),
    created_at: iso(30 * 24 * 60 * 60 * 1000),
    updated_at: iso(2 * 60 * 60 * 1000),
    ...overrides,
  };
}

function makeRun(overrides: Partial<TestRun> = {}): TestRun {
  const id = overrides.id ?? 101;
  return {
    id,
    config_id: 1,
    run_type: 'backup',
    backup_type: 'full',
    status: 'completed',
    provider: 'local',
    file_name: `backup-${id}.sql.gz`,
    file_path: `/backups/backup-${id}.sql.gz`,
    file_size: MB,
    record_count: 100,
    table_count: 10,
    checksum: 'sha256:abc',
    duration_ms: 12_000,
    error_message: null,
    metadata: {},
    started_at: iso(60 * 60 * 1000),
    completed_at: iso(59 * 60 * 1000),
    created_at: iso(60 * 60 * 1000),
    ...overrides,
  };
}

const baseConfigs = (): TestConfig[] => [
  makeConfig(),
  makeConfig({
    id: 2,
    name: 'Weekly Local',
    enabled: false,
    backup_type: 'incremental',
    frequency_days: 7,
    provider: 'local',
    provider_config: { path: '/backups' },
    compress: false,
    encrypt: false,
  }),
];

// 3 completed + 1 failed → 75% success rate. s3 stores 6MB across 2 runs,
// local stores 2MB across 2 runs, total 8MB.
const baseRuns = (): TestRun[] => [
  makeRun({ id: 101, provider: 's3', file_size: 5 * MB, record_count: 1000, duration_ms: 45_000 }),
  makeRun({ id: 102, provider: 'local', file_size: 2 * MB }),
  makeRun({ id: 103, provider: 's3', file_size: 1 * MB }),
  makeRun({
    id: 104,
    provider: 'local',
    status: 'failed',
    error_message: 'disk full',
    file_size: 0,
    file_name: null,
    record_count: 0,
    duration_ms: 0,
    completed_at: null,
  }),
];

interface RouteState {
  configs: TestConfig[];
  runs: TestRun[];
  configsError?: unknown;
  runsError?: unknown;
  verify: { verified: boolean } | null;
  preview: RestorePreview;
  previewError?: unknown;
}

let routeState: RouteState;

function configureRoutes(overrides: Partial<RouteState> = {}) {
  routeState = {
    configs: baseConfigs(),
    runs: baseRuns(),
    verify: { verified: true },
    preview: {
      tables: [
        { name: 'vehicles', rows: 12 },
        { name: 'drives', rows: 3400 },
      ],
      metadata: { version: 1 },
      checksum_verified: true,
    },
    ...overrides,
  };
}

function installRouter() {
  mockedRequest.mockImplementation(
    async (path: string, options?: { method?: string; body?: string }) => {
      const method = (options?.method ?? 'GET').toUpperCase();

      if (path === '/backup/configs' && method === 'GET') {
        if (routeState.configsError) throw routeState.configsError;
        return routeState.configs as unknown as never;
      }
      if (path === '/backup/runs' && method === 'GET') {
        if (routeState.runsError) throw routeState.runsError;
        return routeState.runs as unknown as never;
      }
      if (path === '/backup/configs' && method === 'POST') {
        const body = options?.body ? JSON.parse(options.body) : {};
        return { id: 999, created_at: iso(0), updated_at: iso(0), ...body } as unknown as never;
      }
      if (/^\/backup\/configs\/\d+$/.test(path) && method === 'PUT') {
        const id = Number(path.split('/').pop());
        const body = options?.body ? JSON.parse(options.body) : {};
        return { id, created_at: iso(0), updated_at: iso(0), ...body } as unknown as never;
      }
      if (/^\/backup\/configs\/\d+$/.test(path) && method === 'DELETE') {
        return undefined as unknown as never;
      }
      if (/^\/backup\/configs\/\d+\/trigger$/.test(path) && method === 'POST') {
        return undefined as unknown as never;
      }
      if (path === '/backup/quick' && method === 'POST') {
        return undefined as unknown as never;
      }
      if (/^\/backup\/runs\/\d+\/verify$/.test(path) && method === 'POST') {
        return routeState.verify as unknown as never;
      }
      if (/^\/backup\/runs\/\d+\/preview$/.test(path)) {
        if (routeState.previewError) throw routeState.previewError;
        return routeState.preview as unknown as never;
      }
      throw new Error(`Unhandled request: ${method} ${path}`);
    },
  );
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={['/admin/backup']}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <BackupRestorePage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// Wait until both queries have resolved and the KPI band replaced its skeleton.
async function waitForLoaded() {
  await screen.findByText('Total Configs');
}

beforeEach(() => {
  configureRoutes();
  installRouter();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('BackupRestorePage — data rendering', () => {
  it('renders the KPI band with derived totals, success-rate and size', async () => {
    renderPage();
    await waitForLoaded();

    // Overview region is an accessible landmark (section + aria-label).
    expect(screen.getByRole('region', { name: 'Backup overview' })).toBeInTheDocument();

    // Labels for all six KPIs.
    expect(screen.getByText('Total Configs')).toBeInTheDocument();
    expect(screen.getByText('Total Backups')).toBeInTheDocument();
    expect(screen.getByText('Failed Runs')).toBeInTheDocument();
    expect(screen.getByText('Total Size')).toBeInTheDocument();

    // Derived values: 3 completed of 4 → 75%, total size 8.0 MB.
    expect(screen.getAllByText('75%').length).toBeGreaterThan(0);
    expect(screen.getByText('8.0 MB')).toBeInTheDocument();
  });

  it('lists backup configurations and flags disabled ones', async () => {
    renderPage();
    await waitForLoaded();

    expect(await screen.findByText('Nightly Full')).toBeInTheDocument();
    expect(screen.getByText('Weekly Local')).toBeInTheDocument();
    // Only the disabled config renders the "Disabled" badge.
    expect(screen.getAllByText('Disabled')).toHaveLength(1);
  });

  it('derives the reliability panel: success-rate, per-provider storage and recent errors', async () => {
    renderPage();
    await waitForLoaded();

    expect(screen.getByText('Reliability & Storage')).toBeInTheDocument();
    // Completed-vs-total sublabel.
    expect(screen.getByText('3 / 4')).toBeInTheDocument();
    // s3 accumulates 6MB across 2 runs (sorted first by size).
    expect(screen.getByText('6.0 MB · 2')).toBeInTheDocument();
    expect(screen.getByText('2.0 MB · 2')).toBeInTheDocument();
    // The single failed run surfaces in Recent Errors.
    expect(screen.getByText(/disk full/)).toBeInTheDocument();
  });

  it('renders the history table and only exposes actions on completed runs', async () => {
    renderPage();
    await waitForLoaded();

    expect(await screen.findByText('backup-101.sql.gz')).toBeInTheDocument();
    expect(screen.getByText('backup-102.sql.gz')).toBeInTheDocument();
    // Failed run: status badge present.
    expect(screen.getByText('failed')).toBeInTheDocument();

    // 3 completed runs → 3 of each completed-only action; the failed run adds none.
    expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Verify' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Preview' })).toHaveLength(3);
  });

  it('renders explicit empty states when there is no data', async () => {
    configureRoutes({ configs: [], runs: [] });
    renderPage();
    await waitForLoaded();

    expect(await screen.findByText('No backup configurations')).toBeInTheDocument();
    expect(screen.getByText('No backup runs yet')).toBeInTheDocument();
    expect(screen.getByText('No backup runs to analyze yet.')).toBeInTheDocument();
  });

  it('surfaces the QueryError recovery UI when the configs query fails', async () => {
    configureRoutes({ configsError: new Error('boom') });
    renderPage();
    await waitForLoaded();

    // Network-style failure → retry affordance, and no config rows rendered.
    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText('Nightly Full')).not.toBeInTheDocument();
  });
});

describe('BackupRestorePage — actions & mutations', () => {
  it('triggers a quick backup via POST /backup/quick', async () => {
    renderPage();
    await waitForLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Quick Backup' }));

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        '/backup/quick',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(await screen.findByText('Quick backup started')).toBeInTheDocument();
  });

  it('creates a config: Create is gated on a name, submits the body, closes and toasts', async () => {
    renderPage();
    await waitForLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'New Config' }));

    const dialog = await screen.findByRole('dialog');
    const createBtn = within(dialog).getByRole('button', { name: 'Create' });
    // Gated: empty name keeps the submit disabled.
    expect(createBtn).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'My New Backup' },
    });
    expect(createBtn).not.toBeDisabled();

    fireEvent.click(createBtn);

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        '/backup/configs',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"name":"My New Backup"'),
        }),
      ),
    );
    // Success closes the modal and toasts.
    expect(await screen.findByText('Config created')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('swaps the dynamic provider-credential fields when the provider changes', async () => {
    renderPage();
    await waitForLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'New Config' }));
    const dialog = await screen.findByRole('dialog');

    // Default provider is local → a single Path field.
    expect(within(dialog).getByLabelText(/Path/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Bucket/)).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('Provider'), {
      target: { value: 's3' },
    });

    // S3 reveals bucket/region/credentials and drops the local Path field.
    expect(within(dialog).getByLabelText(/Bucket/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Region/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Secret Key/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Path/)).not.toBeInTheDocument();
  });

  it('edits a config via PUT /backup/configs/:id', async () => {
    renderPage();
    await waitForLoaded();

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);

    const dialog = await screen.findByRole('dialog');
    const nameInput = within(dialog).getByLabelText('Name') as HTMLInputElement;
    // Edit prefills the row's current values.
    expect(nameInput.value).toBe('Nightly Full');

    fireEvent.change(nameInput, { target: { value: 'Nightly Full v2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        '/backup/configs/1',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"name":"Nightly Full v2"'),
        }),
      ),
    );
    expect(await screen.findByText('Config updated')).toBeInTheDocument();
  });

  it('deletes a config only after confirmation', async () => {
    renderPage();
    await waitForLoaded();

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);

    // Confirmation dialog names the target and gates the DELETE.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Nightly Full/)).toBeInTheDocument();
    expect(mockedRequest).not.toHaveBeenCalledWith(
      '/backup/configs/1',
      expect.objectContaining({ method: 'DELETE' }),
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        '/backup/configs/1',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    expect(await screen.findByText('Config deleted')).toBeInTheDocument();
  });

  it('triggers an on-demand run via POST /backup/configs/:id/trigger', async () => {
    renderPage();
    await waitForLoaded();

    fireEvent.click(screen.getAllByRole('button', { name: 'Trigger now' })[0]);

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        '/backup/configs/1/trigger',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(await screen.findByText('Backup triggered')).toBeInTheDocument();
  });

  it('opens the canonical apiUrl download target in a new tab', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    renderPage();
    await waitForLoaded();

    fireEvent.click(screen.getAllByRole('button', { name: 'Download' })[0]);

    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, target] = openSpy.mock.calls[0];
    // apiUrl() must produce the /api/v1-prefixed download path.
    expect(url).toMatch(/^\/api\/v1\/backup\/runs\/\d+\/download$/);
    expect(target).toBe('_blank');

    openSpy.mockRestore();
  });

  it('verify tolerates a 204/empty body and reports a checksum mismatch', async () => {
    // 204 No Content → request() resolves undefined. The handler must not crash.
    configureRoutes({ verify: null });
    installRouter();

    renderPage();
    await waitForLoaded();

    fireEvent.click(screen.getAllByRole('button', { name: 'Verify' })[0]);

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        expect.stringMatching(/^\/backup\/runs\/\d+\/verify$/),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(await screen.findByText('Checksum mismatch')).toBeInTheDocument();
    expect(screen.queryByText('Checksum verified')).not.toBeInTheDocument();
  });

  it('verify confirms a validated checksum when the body reports verified', async () => {
    configureRoutes({ verify: { verified: true } });
    installRouter();

    renderPage();
    await waitForLoaded();

    fireEvent.click(screen.getAllByRole('button', { name: 'Verify' })[0]);

    expect(await screen.findByText('Checksum verified')).toBeInTheDocument();
  });
});

describe('BackupRestorePage — restore preview', () => {
  it('renders the table manifest and a verified checksum status', async () => {
    renderPage();
    await waitForLoaded();

    fireEvent.click(screen.getAllByRole('button', { name: 'Preview' })[0]);

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        expect.stringMatching(/^\/backup\/runs\/\d+\/preview$/),
      ),
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Checksum verified')).toBeInTheDocument();
    expect(within(dialog).getByText('vehicles')).toBeInTheDocument();
    expect(within(dialog).getByText('drives')).toBeInTheDocument();
  });

  it('handles an empty manifest and a failed checksum', async () => {
    configureRoutes({
      preview: { tables: [], metadata: null, checksum_verified: false },
    });
    installRouter();

    renderPage();
    await waitForLoaded();

    fireEvent.click(screen.getAllByRole('button', { name: 'Preview' })[0]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Checksum verification failed')).toBeInTheDocument();
    expect(within(dialog).getByText('No tables found in backup')).toBeInTheDocument();
  });

  it('toasts and stays closed when the preview fetch fails', async () => {
    configureRoutes({ previewError: new ApiError('nope', 500, 'INTERNAL') });
    installRouter();

    renderPage();
    await waitForLoaded();

    fireEvent.click(screen.getAllByRole('button', { name: 'Preview' })[0]);

    expect(await screen.findByText('Failed to load preview')).toBeInTheDocument();
    // The restore-preview modal never opened.
    expect(screen.queryByText('Restore Preview')).not.toBeInTheDocument();
  });
});
