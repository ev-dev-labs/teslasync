/**
 * DataExportPage contract + hardening tests.
 *
 * The page has a single public export (the default `DataExportPage`); every
 * sub-component (`StatsRow`, `ExportWizard`, `ColumnPickerSection`,
 * `ExportHistoryTable`, `AccountExportPanel`, the badges, …) is module-private
 * and is exercised here through the mounted page.
 *
 * Coverage:
 *   1.  Loaded render — KPI band + wizard + history all mount from mocked data.
 *   2.  `StatsRow` useMemo aggregation (count / summed bytes / most-exported).
 *   3.  Export wizard submit — type + format + default 30-day range reach the API.
 *   4.  "All Time" preset omits the start/end window.
 *   5.  UTC date-only bounds, inclusive midnight end, and invalid ranges.
 *   6.  Column picker — required column locked, unchecked column dropped on submit.
 *   7.  Account ("Download my data") export queues against /export/jobs/account.
 *   8.  Empty state when there are no jobs.
 *   9.  Load-error banner + non-crashing page.
 *   10. Download action opens the artifact URL.
 *   11. BUG FIX: an unrecognized job status renders a neutral chip instead of
 *       throwing on `undefined.icon` (would have taken the whole table down).
 *   12. BUG FIX: a missing/unknown format renders without throwing on
 *       `undefined.toUpperCase()`.
 *   13. RequiresAuth gates the scheduled-exports section in open mode.
 *
 * Network is mocked at the shared `request` helper so the real TanStack Query
 * hooks (useExports / useAuthMode) run end-to-end without hitting the wire.
 * i18n is stubbed so `t(key, 'Default')` resolves to the English default.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
const savedSettings = vi.hoisted(() => ({
  locale: 'en-US', timezone_user: 'UTC', decimal_precision: 2, currency_symbol: '$',
}));
vi.mock('@/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({ settings: savedSettings, settingsUnavailable: false }),
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') return fallbackOrOpts;
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') return o.defaultValue;
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { request } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import DataExportPage from './DataExportPage';
import type { Vehicle } from '@/api/types';
import type { ExportColumnsResponse } from '@/api/hooks/useExports';
import type { AuthModeResponse } from '@/api/types';

const mockedRequest = request as unknown as Mock;

/* ------------------------------------------------------------------ */
/*  Mutable per-test fixtures                                          */
/* ------------------------------------------------------------------ */

interface TestJob {
  id: string;
  type: string;
  format: string | undefined;
  status: string;
  vehicle_id?: number;
  record_count?: number | null;
  file_size?: number | null;
  duration_ms?: number;
  error_message?: string;
  created_at: string;
  completed_at?: string;
}

interface ReqOpts {
  method?: string;
  body?: unknown;
  signal?: unknown;
}

interface SubmitBody {
  type?: string;
  format?: string;
  vehicle_id?: number;
  start?: string;
  end?: string;
  columns?: string[];
}

const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

let jobsData: TestJob[];
let jobsError: Error | null;
let vehiclesData: Vehicle[];
let vehiclesError: Error | null;
let vehiclesPending: Promise<Vehicle[]> | null;
let columnsData: Partial<ExportColumnsResponse> | null | Error;
let authModeData: AuthModeResponse;
let postCalls: { url: string; body: unknown }[];

function baseVehicle(): Vehicle {
  return {
    id: 1,
    vehicle_id: 1001,
    vin: 'VIN00000000000001',
    display_name: 'Model 3',
    model: 'model3',
    trim_badging: 'p',
    exterior_color: 'black',
    wheel_type: 'aero',
    state: 'online',
    healthy: true,
    created_at: iso(9_000_000),
    updated_at: iso(1000),
  };
}

function resetData() {
  savedSettings.locale = 'en-US';
  savedSettings.timezone_user = 'UTC';
  jobsError = null;
  vehiclesData = [baseVehicle()];
  vehiclesError = null;
  vehiclesPending = null;
  postCalls = [];
  authModeData = {
    mode: 'open',
    capabilities: {
      step_up_reauth: false,
      totp_enrollment: false,
      session_list: false,
      impersonation: false,
      rbac: false,
    },
  };
  columnsData = {
    type: 'drives',
    supports_selection: true,
    columns: [
      { name: 'started_at', label: 'Started At', always_included: true },
      { name: 'distance_m', label: 'Distance (m)', always_included: false },
      { name: 'duration_s', label: 'Duration (s)', always_included: false },
    ],
  };
  jobsData = [
    {
      id: 'job-ready',
      type: 'drives',
      format: 'csv',
      status: 'ready',
      vehicle_id: 1,
      record_count: 1200,
      file_size: 2048,
      duration_ms: 65_000,
      created_at: iso(5 * 60_000),
    },
    {
      id: 'job-failed',
      type: 'charging',
      format: 'json',
      status: 'failed',
      error_message: 'disk full',
      duration_ms: 3000,
      created_at: iso(2 * 3_600_000),
    },
    {
      id: 'job-expired',
      type: 'drives',
      format: 'csv',
      status: 'expired',
      file_size: 5_000_000,
      created_at: iso(3 * 86_400_000),
    },
  ];
}

function routeRequest(url: string, opts?: ReqOpts): Promise<unknown> {
  const method = (opts?.method ?? 'GET').toUpperCase();
  if (method === 'POST' && (url === '/export/jobs' || url === '/export/jobs/account')) {
    postCalls.push({ url, body: opts?.body });
    return Promise.resolve({ id: 'queued-job', status: 'queued' });
  }
  if (url === '/export/jobs') {
    return jobsError ? Promise.reject(jobsError) : Promise.resolve(jobsData);
  }
  if (url === '/vehicles') return vehiclesPending ?? (vehiclesError ? Promise.reject(vehiclesError) : Promise.resolve(vehiclesData));
  if (url.startsWith('/exports/columns')) {
    return columnsData instanceof Error
      ? Promise.reject(columnsData)
      : Promise.resolve(columnsData);
  }
  if (url === '/system/auth-mode') return Promise.resolve(authModeData);
  if (url === '/scheduled-exports') return Promise.resolve([]);
  return Promise.resolve(undefined);
}

function lastPostBody(url: string): SubmitBody {
  const call = [...postCalls].reverse().find((c) => c.url === url);
  if (!call) throw new Error(`no POST recorded for ${url}`);
  return JSON.parse(call.body as string) as SubmitBody;
}

/** Return the metric card wrapper (`div.flex-1`) that owns a given label so
 *  the value paragraph can be asserted without cross-card collisions. */
function metricCard(label: string): HTMLElement {
  const el = screen.getByText(label).closest('[data-operational-metric]');
  if (!el) throw new Error(`no metric card for "${label}"`);
  return el as HTMLElement;
}

function renderPage(entry = '/data-export', configure?: (client: QueryClient) => void) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  configure?.(qc);
  const result = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <ToastProvider>
          <DataExportPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient: qc };
}

describe('Data export responsive callers', () => {
  it('keeps mobile targets, desktop density and keyboard access to custom dates', async () => {
    const user = userEvent.setup();
    renderPage();
    const custom = await screen.findByRole('button', { name: 'Custom range' });
    expect(custom).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-9', 'whitespace-normal');
    custom.focus();
    await user.keyboard('{Enter}');
    const start = screen.getByLabelText('Start');
    const end = screen.getByLabelText('End');
    expect(start).toHaveClass('min-h-11', 'md:min-h-10');
    expect(end).toHaveClass('min-h-11', 'md:min-h-10');
    expect(start.parentElement?.parentElement?.parentElement).toHaveClass('grid-cols-1', 'sm:grid-cols-2');
    fireEvent.change(start, { target: { value: '2026-01-01' } });
    fireEvent.change(end, { target: { value: '2026-01-31' } });
    const submit = screen.getByRole('button', { name: 'Start export' });
    submit.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(lastPostBody('/export/jobs')).toMatchObject({
      start: '2026-01-01', end: '2026-01-31',
    }));
    for (const name of ['Last 7 days', 'Last 30 days', 'Clear', 'Start full export']) {
      expect(screen.getByRole('button', { name, exact: true })).toHaveClass('min-h-11', 'min-w-11', 'whitespace-normal');
    }
    for (const name of ['CSV', 'JSON']) {
      const choice = screen.getByRole('radio', { name, exact: true });
      expect(choice.closest('label')?.querySelector('span')).toHaveClass('min-h-11', 'min-w-0');
    }
  });
});

beforeEach(() => {
  resetData();
  mockedRequest.mockReset();
  mockedRequest.mockImplementation((url: string, opts?: ReqOpts) => routeRequest(url, opts));
  // Keep the floating JobProgressDrawer out of the way — dismissed + no active
  // jobs means it renders nothing and never collides with page queries.
  window.localStorage.setItem('teslasync.exportDrawer.state', 'dismissed');
});

afterEach(() => {
  vi.useRealTimers();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('DataExportPage — Project Apex elevation', () => {
  it.each([
    ['missing', undefined, '—'],
    ['null', null, '—'],
    ['NaN', Number.NaN, '—'],
    ['positive infinity', Number.POSITIVE_INFINITY, '—'],
    ['negative infinity', Number.NEGATIVE_INFINITY, '—'],
    ['measured zero', 0, '0 B'],
    ['positive', 512, '512 B'],
    ['negative', -512, '-512 B'],
    ['fractional', 0.5, '0.5 B'],
    ['negative fractional', -0.5, '-0.5 B'],
    ['scaled fractional', 1536, '1.50 KB'],
  ] satisfies [string, number | null | undefined, string][])(
    'renders %s history bytes distinctly from missing measurements',
    async (_case, fileSize, expected) => {
      jobsData = [{ ...jobsData[0], file_size: fileSize }];
      renderPage();
      const table = await screen.findByRole('table');
      const row = within(table).getByRole('row', { name: /Drives CSV Ready/ });

      expect(within(row).getAllByRole('cell')[5]).toHaveTextContent(expected);
      expect(within(row).getByRole('button', { name: 'Download' })).toBeEnabled();
    },
  );

  it.each(['paused', 'idle'] as const)('keeps initial %s sources distinct from empty results and recovers independently', async (fetchStatus) => {
    mockedRequest.mockImplementation((url: string, opts?: ReqOpts) =>
      url.startsWith('/exports/columns') ? new Promise(() => {}) : routeRequest(url, opts));
    if (fetchStatus === 'paused') onlineManager.setOnline(false);
    const { queryClient } = renderPage('/data-export', client => {
      if (fetchStatus === 'idle') client.setDefaultOptions({ queries: { retry: false, enabled: false } });
    });
    const history = screen.getByRole('region', { name: 'Export history' });
    expect(within(history).queryByText('No exports yet')).not.toBeInTheDocument();
    expect(screen.queryByText('No data available')).not.toBeInTheDocument();
    expect(screen.queryByText('No vehicles available')).not.toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    if (fetchStatus === 'paused') {
      expect(within(history).getByText('Refresh paused')).toBeInTheDocument();
    }

    act(() => {
      queryClient.setQueryData(['vehicles'], vehiclesData);
      queryClient.setQueryData(['export-columns', 'drives'], columnsData);
    });
    expect(await screen.findByTestId('export-column-picker')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start export' })).toBeEnabled();
    expect(within(history).queryByText('No exports yet')).not.toBeInTheDocument();

    act(() => { queryClient.setQueryData(['export-jobs'], jobsData); });
    expect(await within(history).findByRole('table')).toBeInTheDocument();
    act(() => { queryClient.setQueryData(['export-jobs'], []); });
    expect(await within(history).findByText('No exports yet')).toBeInTheDocument();
    expect(screen.getByTestId('export-column-picker')).toBeInTheDocument();
    queryClient.clear();
  });

  it('keeps populated history usable while the vehicle and column sources are unresolved', async () => {
    mockedRequest.mockImplementation((url: string, opts?: ReqOpts) =>
      url.startsWith('/exports/columns') ? new Promise(() => {}) : routeRequest(url, opts));
    const { queryClient } = renderPage('/data-export', client => {
      client.setDefaultOptions({ queries: { retry: false, enabled: false } });
      client.setQueryData(['export-jobs'], jobsData);
    });
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByText('No data available')).not.toBeInTheDocument();
    expect(screen.queryByText('No vehicles available')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start export' })).toBeDisabled();

    act(() => {
      queryClient.setQueryData(['vehicles'], []);
      queryClient.setQueryData(['export-columns', 'drives'], { type: 'drives', supports_selection: true, columns: [] });
    });
    expect(await screen.findByText('No export columns are available for this data type.')).toBeInTheDocument();
    expect(screen.getAllByText('No vehicles available')).toHaveLength(2);
    expect(screen.getByRole('table')).toBeInTheDocument();
    queryClient.clear();
  });

  it.each([
    ['Records', 'record_count'],
    ['Size', 'file_size'],
  ] as const)('sorts %s by raw numbers, keeps missing values last and preserves source ties', async (header, field) => {
    const values = [undefined, 2, 1000, 2, 0, null];
    jobsData = values.map((value, index) => ({
      id: `sort-${index}`,
      type: 'drives',
      format: 'csv',
      status: 'failed',
      error_message: `source-${index}`,
      created_at: iso(1000),
      [field]: value,
    }));
    const sourceIds = jobsData.map(job => job.id);
    renderPage();
    const table = await screen.findByRole('table');
    const rowOrder = () => within(table).getAllByRole('row').slice(1)
      .map(row => within(row).getByText(/^source-/).textContent);
    expect(rowOrder()).toEqual(['source-0', 'source-1', 'source-2', 'source-3', 'source-4', 'source-5']);
    const column = within(table).getByRole('columnheader', { name: new RegExp(header) });
    fireEvent.click(within(column).getByRole('button', { name: header, exact: true }));
    expect(column).toHaveAttribute('aria-sort', 'descending');
    expect(rowOrder()).toEqual(['source-2', 'source-1', 'source-3', 'source-4', 'source-0', 'source-5']);
    fireEvent.click(within(column).getByRole('button', { name: header, exact: true }));
    expect(column).toHaveAttribute('aria-sort', 'ascending');
    expect(rowOrder()).toEqual(['source-4', 'source-1', 'source-3', 'source-2', 'source-0', 'source-5']);
    expect(jobsData.map(job => job.id)).toEqual(sourceIds);
    expect(screen.getByRole('region', { name: 'Export jobs' })).toContainElement(table);
  });

  it.each(['Type', 'Status'])('controls %s sorting using source enum values', async (header) => {
    jobsData = [
      { id: 'a', type: 'full_backup', format: 'csv', status: 'ready', record_count: 101, created_at: iso(1000) },
      { id: 'b', type: 'charging', format: 'csv', status: 'expired', record_count: 102, created_at: iso(1000) },
      { id: 'c', type: 'drives', format: 'csv', status: 'failed', record_count: 103, created_at: iso(1000) },
    ];
    renderPage();
    const table = await screen.findByRole('table');
    const column = within(table).getByRole('columnheader', { name: new RegExp(header) });
    const order = () => within(table).getAllByRole('row').slice(1)
      .map(row => within(row).getByText(/^10[1-3]$/).textContent);
    fireEvent.click(within(column).getByRole('button', { name: header, exact: true }));
    expect(column).toHaveAttribute('aria-sort', 'descending');
    expect(order()).toEqual(['101', '103', '102']);
    fireEvent.click(within(column).getByRole('button', { name: header, exact: true }));
    expect(column).toHaveAttribute('aria-sort', 'ascending');
    expect(order()).toEqual(['102', '103', '101']);
  });

  it('sorts time by actual instants rather than timestamp strings and leaves invalid times last', async () => {
    jobsData = [
      { id: 'earlier', type: 'drives', format: 'csv', status: 'failed', error_message: 'earlier instant', created_at: '2026-01-01T10:00:00+02:00' },
      { id: 'invalid', type: 'drives', format: 'csv', status: 'failed', error_message: 'unknown instant', created_at: '' },
      { id: 'later', type: 'drives', format: 'csv', status: 'failed', error_message: 'later instant', created_at: '2026-01-01T09:00:00Z' },
    ];
    renderPage();
    const table = await screen.findByRole('table');
    const column = within(table).getByRole('columnheader', { name: /Time/ });
    const order = () => within(table).getAllByRole('row').slice(1)
      .map(row => within(row).getByText(/instant$/).textContent);
    fireEvent.click(within(column).getByRole('button', { name: 'Time', exact: true }));
    expect(order()).toEqual(['later instant', 'earlier instant', 'unknown instant']);
    fireEvent.click(within(column).getByRole('button', { name: 'Time', exact: true }));
    expect(order()).toEqual(['earlier instant', 'later instant', 'unknown instant']);
  });

  it('uses a native grouped radio for every export type while retaining descriptions and selection', async () => {
    renderPage();
    const group = await screen.findByRole('radiogroup', { name: 'STEP 1 — select data type' });
    const choices = within(group).getAllByRole('radio');
    expect(choices.length).toBeGreaterThan(1);
    expect(choices.every((choice) => choice.tagName === 'INPUT' && choice.getAttribute('name') === 'export-type')).toBe(true);
    expect(within(group).getByRole('radio', { name: 'Drives' })).toBeChecked();
    const charging = within(group).getByRole('radio', { name: 'Charging' });
    charging.focus();
    expect(charging).toHaveFocus();
    fireEvent.click(charging);
    expect(charging).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Drives' })).not.toBeChecked();
  });

  it('exposes only supported formats as native exclusive choices and preserves keyboard selection on submit', async () => {
    const user = userEvent.setup();
    renderPage();
    const group = await screen.findByRole('radiogroup', { name: 'STEP 2 — choose format' });
    const choices = within(group).getAllByRole('radio');
    expect(choices.map(choice => choice.getAttribute('value'))).toEqual(['csv', 'json']);
    expect(choices.every(choice => choice.tagName === 'INPUT' && choice.getAttribute('name') === 'export-format')).toBe(true);
    const csv = within(group).getByRole('radio', { name: 'CSV' });
    const json = within(group).getByRole('radio', { name: 'JSON' });
    expect(csv).toBeChecked();
    expect(json).not.toBeChecked();
    expect(csv).toHaveAccessibleDescription('Comma-separated values, compatible with Excel and Google Sheets');
    expect(json).toHaveAccessibleDescription('Structured JSON format for programmatic access');

    csv.focus();
    await user.keyboard('{ArrowRight}');
    expect(json).toHaveFocus();
    expect(json).toBeChecked();
    expect(csv).not.toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Charging', exact: true }));
    expect(json).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() => expect(lastPostBody('/export/jobs')).toMatchObject({ type: 'charging', format: 'json' }));

    json.focus();
    await user.keyboard('{ArrowLeft}');
    expect(csv).toHaveFocus();
    expect(csv).toBeChecked();
    expect(json).not.toBeChecked();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start export' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() => {
      expect(postCalls.filter(call => call.url === '/export/jobs')).toHaveLength(2);
      expect(lastPostBody('/export/jobs')).toMatchObject({ type: 'charging', format: 'csv' });
    });
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('renders the KPI band, export wizard and history once data resolves', async () => {
    renderPage();

    // The KPI tiles only leave their loading skeletons once the jobs query
    // resolves — gate on one of them before the synchronous assertions.
    expect(await screen.findByText('Total exports')).toBeInTheDocument();
    await waitFor(() => expect(metricCard('Total exports')).toHaveAttribute('data-value-state', 'value'));
    expect(screen.getByText('New export')).toBeInTheDocument();

    expect(screen.getByText('Total size')).toBeInTheDocument();
    expect(screen.getByText('Most exported')).toBeInTheDocument();
    expect(screen.getByText('Last export')).toBeInTheDocument();

    expect(screen.getByText('Export history')).toBeInTheDocument();
    // Failed row surfaces its error message as visible + title text.
    expect(screen.getByText('disk full')).toBeInTheDocument();
  });

  it('aggregates the stat tiles from job data (count, summed bytes, top type)', async () => {
    renderPage();
    await screen.findByText('Total exports');
    await waitFor(() => expect(metricCard('Total exports')).toHaveAttribute('data-value-state', 'value'));

    // 3 jobs total.
    expect(within(metricCard('Total exports')).getByText('3')).toBeInTheDocument();
    // 2048 + 0 + 5_000_000 bytes → "4.8 MB".
    expect(within(metricCard('Total size')).getByText('4.77 MB')).toBeInTheDocument();
    // drives x2 beats charging x1 — rendered lower-cased from the type key.
    expect(within(metricCard('Most exported')).getByText('drives')).toBeInTheDocument();
  });

  it('opens the real export review drawer with recorded bytes and by-count type context', async () => {
    renderPage();
    await waitFor(() => expect(metricCard('Total exports')).toHaveAttribute('data-value-state', 'value'));
    const summary = screen.getByRole('region', { name: 'Export summary metrics' });
    expect(summary.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(within(metricCard('Most exported')).getByText('By count')).toBeInTheDocument();
    expect(metricCard('Total size')).toHaveAttribute('data-value-state', 'value');
    fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('4.77 MB')).toBeInTheDocument();
    expect(within(drawer).getByText('By count')).toBeInTheDocument();
    expect(drawer.querySelector('[data-drawer-header]')).toHaveTextContent('Loaded export jobs; no server-wide total or reporting window is supplied.');
  });

  it('keeps all four export metrics and creation/download controls after a failed background refresh', async () => {
    renderPage();
    await waitFor(() => expect(metricCard('Total exports')).toHaveAttribute('data-value-state', 'value'));
    jobsError = new Error('background export refresh failed');
    const history = screen.getByRole('region', { name: 'Export history' });
    fireEvent.click(within(history).getByRole('button', { name: 'Refresh' }));
    await screen.findByTestId('stale-refresh-warning');
    const summary = screen.getByRole('region', { name: 'Export summary metrics' });
    expect(within(summary).getByText('Retained source')).toBeInTheDocument();
    expect(within(metricCard('Total exports')).getByText('3')).toBeInTheDocument();
    expect(within(metricCard('Total size')).getByText('4.77 MB')).toBeInTheDocument();
    expect(within(metricCard('Most exported')).getByText('drives')).toBeInTheDocument();
    expect(metricCard('Last export')).toHaveAttribute('data-value-state', 'value');
    expect(screen.getByRole('button', { name: 'Start export' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled();
  });

  it('submits a new export with the chosen type, format and default 30-day window', async () => {
    renderPage();
    await screen.findByText('New export');

    fireEvent.click(screen.getByRole('radio', { name: 'JSON' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Charging' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));

    await waitFor(() => {
      expect(postCalls.some((c) => c.url === '/export/jobs')).toBe(true);
    });

    const body = lastPostBody('/export/jobs');
    expect(body.type).toBe('charging');
    expect(body.format).toBe('json');
    // 30-day preset is the default selection, so a bounded window is sent.
    expect(typeof body.start).toBe('string');
    expect(typeof body.end).toBe('string');
  });

  it('omits the date range when the "All Time" preset is selected', async () => {
    renderPage();
    await screen.findByText('New export');

    fireEvent.click(screen.getByRole('button', { name: 'All time' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));

    await waitFor(() => {
      expect(postCalls.some((c) => c.url === '/export/jobs')).toBe(true);
    });

    const body = lastPostBody('/export/jobs');
    expect(body.type).toBe('drives');
    expect(body.start).toBeUndefined();
    expect(body.end).toBeUndefined();
  });

  it('forwards a custom date range when the user supplies one', async () => {
    renderPage();
    await screen.findByText('New export');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start export' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'Custom range' }));
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2025-03-01' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2025-03-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));

    await waitFor(() => {
      expect(postCalls.some((c) => c.url === '/export/jobs')).toBe(true);
    });

    const body = lastPostBody('/export/jobs');
    expect(body.start).toBe('2025-03-01');
    expect(body.end).toBe('2025-03-31');
  });

  it.each([
    ['de-DE', 'America/Los_Angeles', '2026-03-08'],
    ['fr-FR', 'Pacific/Auckland', '2026-11-01'],
  ])('keeps both endpoints on UTC date-only bounds with saved %s / %s settings', async (locale, timezone, day) => {
    savedSettings.locale = locale;
    savedSettings.timezone_user = timezone;
    renderPage();
    await screen.findByText('New export');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start export' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Custom range' }));
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: day } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: day } });
    fireEvent.change(screen.getByLabelText('Start date (optional)'), { target: { value: day } });
    fireEvent.change(screen.getByLabelText('End date (optional)'), { target: { value: day } });
    expect(screen.getAllByText('Start 00:00 UTC ≤ Timestamp ≤ End 00:00 UTC')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start full export' }));
    await waitFor(() => {
      expect(lastPostBody('/export/jobs')).toMatchObject({ start: day, end: day });
      expect(lastPostBody('/export/jobs/account')).toMatchObject({ start: day, end: day });
    });
  });

  it.each(['2026-03-08T00:00:00.000Z', '2026-03-08T23:59:59.999Z'])(
    'uses UTC calendar arithmetic at the day boundary %s despite saved timezone',
    async now => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(now));
      savedSettings.locale = 'de-DE';
      savedSettings.timezone_user = 'America/Los_Angeles';
      renderPage();
      await screen.findByText('New export');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Start export' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
      fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
      await waitFor(() => expect(lastPostBody('/export/jobs')).toMatchObject({
        start: '2026-03-01', end: '2026-03-08',
      }));
    },
  );

  it.each([
    ['', ''],
    ['2026-03-08', ''],
    ['', '2026-03-08'],
    ['2026-03-09', '2026-03-08'],
    ['2026-02-30', '2026-03-08'],
    ['invalid', '2026-03-08'],
  ])('blocks incomplete or invalid custom bounds (%s, %s) without falling back to the preset', async (start, end) => {
    renderPage();
    await screen.findByText('New export');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start export' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Custom range' }));
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: start } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: end } });
    expect(screen.getByRole('button', { name: 'Start export' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid date and time.');
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    expect(postCalls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'All time' }));
    expect(screen.getByRole('button', { name: 'Start export' })).toBeEnabled();
  });

  it.each([
    ['2026-03-08', '', { start: '2026-03-08' }],
    ['', '2026-03-08', { end: '2026-03-08' }],
  ])('preserves an independently optional account bound (%s, %s)', async (start, end, expected) => {
    renderPage();
    await screen.findByText('Download my data');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start full export' })).toBeEnabled());
    fireEvent.change(screen.getByRole('combobox', { name: 'Vehicle' }), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Start date (optional)'), { target: { value: start } });
    fireEvent.change(screen.getByLabelText('End date (optional)'), { target: { value: end } });
    fireEvent.click(screen.getByRole('button', { name: 'Start full export' }));
    await waitFor(() => expect(lastPostBody('/export/jobs/account')).toEqual(expected));
  });

  it('blocks a reversed account range and recovers when corrected', async () => {
    renderPage();
    await screen.findByText('Download my data');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start full export' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Start date (optional)'), { target: { value: '2026-03-09' } });
    fireEvent.change(screen.getByLabelText('End date (optional)'), { target: { value: '2026-03-08' } });
    expect(screen.getByRole('button', { name: 'Start full export' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid date and time.');
    fireEvent.click(screen.getByRole('button', { name: 'Start full export' }));
    expect(postCalls).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('End date (optional)'), { target: { value: '2026-03-09' } });
    expect(screen.getByRole('button', { name: 'Start full export' })).toBeEnabled();
  });

  it('locks required columns and drops unchecked ones from the submit payload', async () => {
    renderPage();

    // Picker appears once the columns catalog for "drives" resolves.
    await screen.findByTestId('export-column-picker');

    // The always-included column cannot be toggled off.
    expect(screen.getByTestId('export-column-checkbox-started_at')).toBeDisabled();
    // "Select all" is a no-op while everything is already selected.
    expect(screen.getByTestId('export-column-select-all')).toBeDisabled();

    fireEvent.click(screen.getByTestId('export-column-checkbox-distance_m'));
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));

    await waitFor(() => {
      expect(postCalls.some((c) => c.url === '/export/jobs')).toBe(true);
    });

    const body = lastPostBody('/export/jobs');
    // Order preserved from the catalog; distance_m removed, required kept.
    expect(body.columns).toEqual(['started_at', 'duration_s']);
  });

  it('queues a full account export against /export/jobs/account', async () => {
    renderPage();
    await screen.findByText('Download my data');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start full export' })).toBeEnabled());
    fireEvent.change(screen.getByRole('combobox', { name: 'Vehicle' }), { target: { value: 'all' } });

    fireEvent.click(screen.getByRole('button', { name: 'Start full export' }));

    await waitFor(() => {
      expect(postCalls.some((c) => c.url === '/export/jobs/account')).toBe(true);
    });
    // No vehicle/date scoping selected → empty payload body.
    expect(lastPostBody('/export/jobs/account')).toEqual({});
  });

  it('shows empty states when there are no export jobs', async () => {
    jobsData = [];
    renderPage();

    expect(await screen.findByText('No exports yet')).toBeInTheDocument();
    expect(screen.getByText('Create your first export above to get started.')).toBeInTheDocument();
    expect(within(metricCard('Total exports')).getByText('0')).toBeInTheDocument();
    expect(metricCard('Total size')).toHaveAttribute('data-value-state', 'value');
    expect(metricCard('Total size').querySelector('[data-operational-value]')).toHaveTextContent('0 B');
  });

  it('surfaces a load-error banner without crashing the rest of the page', async () => {
    jobsError = new Error('boom: 500 Internal');
    renderPage();

    expect(await screen.findByText('Failed to load export jobs')).toBeInTheDocument();
    // The wizard (fed by the still-successful vehicles query) keeps working.
    expect(screen.getByText('New export')).toBeInTheDocument();
    expect(metricCard('Total exports')).toHaveAttribute('data-value-state', 'missing');
    expect(metricCard('Total size')).toHaveAttribute('data-value-state', 'missing');
  });

  it('opens the artifact URL for a ready job', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    renderPage();

    // Row actions only appear once the jobs table has rows.
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }));

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('/api/v1/export/jobs/job-ready/download', '_blank');
  });

  it('renders an unrecognized job status as a neutral chip instead of crashing', async () => {
    // Regression guard: the API can ship a status the SPA union doesn't know
    // yet (e.g. "cancelled"). Previously StatusBadge read `undefined.icon` and
    // the SectionErrorBoundary swallowed the whole history table.
    jobsData = [
      {
        id: 'job-x',
        type: 'drives',
        format: 'csv',
        status: 'cancelled',
        record_count: 42,
        created_at: iso(60_000),
      },
    ];
    renderPage();

    // Raw status is shown verbatim, and the row (its type badge + record
    // count) rendered — proving the table body was NOT torn down. Scope to the
    // table so the selector/overview copies of "Drives" don't collide.
    const table = await screen.findByRole('table');
    expect(within(table).getByText('cancelled')).toBeInTheDocument();
    expect(within(table).getByText('Drives')).toBeInTheDocument();
    expect(within(table).getByText('42')).toBeInTheDocument();
  });

  it('renders jobs with unknown / missing formats without throwing', async () => {
    // Regression guard: `format.toUpperCase()` used to crash on undefined.
    jobsData = [
      { id: 'fmt-xml', type: 'drives', format: 'xml', status: 'ready', record_count: 777, created_at: iso(1000) },
      { id: 'fmt-none', type: 'charging', format: undefined, status: 'ready', record_count: 888, created_at: iso(2000) },
    ];
    renderPage();

    // Unknown format is upper-cased defensively; missing format still lets the
    // row render (asserted via its unique record count).
    const table = await screen.findByRole('table');
    const xmlJob = within(table).getByRole('row', { name: /Drives/ });
    const missingFormatJob = within(table).getByRole('row', { name: /Charging/ });
    expect(within(xmlJob).getByText('XML')).toBeInTheDocument();
    expect(within(xmlJob).getByText('777')).toBeInTheDocument();
    expect(within(missingFormatJob).getByText('888')).toBeInTheDocument();
  });

  it('gates the scheduled-exports section behind auth mode (open mode → placeholder)', async () => {
    renderPage();
    await screen.findByText('New export');

    // In open mode the RequiresAuth wrapper renders its stable placeholder and
    // never mounts the underlying scheduled-exports panel.
    expect(screen.getByTestId('requires-auth-empty-session_list')).toBeInTheDocument();
    expect(
      mockedRequest.mock.calls.some((c) => c[0] === '/scheduled-exports'),
    ).toBe(false);
  });

  it('names the wizard vehicle selector and preserves all seven export choices', async () => {
    renderPage();
    const selector = await screen.findByRole('combobox', { name: 'STEP 3 — select vehicle' });
    // Select prepends its placeholder; the empty-valued real choice must
    // remain independently available so users can return to all vehicles.
    const [placeholder, ...vehicleChoices] = within(selector).getAllByRole('option');
    expect(placeholder).toHaveAttribute('value', '');
    expect(placeholder).toHaveTextContent(/^All vehicles$/);
    expect(vehicleChoices.map(option => option.getAttribute('value'))).toEqual(['', '1']);
    expect(within(selector).getAllByRole('option', { name: 'All vehicles' })).toHaveLength(2);
    expect(vehicleChoices[0]).toBeInTheDocument();
    expect(vehicleChoices[0]).toHaveTextContent(/^All vehicles$/);
    expect(vehicleChoices[0]).toBeEnabled();
    expect(within(selector).getByRole('option', { name: 'Model 3' })).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'STEP 1 — select data type' });
    expect(within(group).getAllByRole('radio').map(choice => choice.getAttribute('aria-label')))
      .toEqual(['Drives', 'Charging', 'Trips', 'Analytics', 'Full backup', 'Maintenance', 'Energy']);

    fireEvent.change(selector, { target: { value: '1' } });
    expect(selector).toHaveValue('1');
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() => expect(lastPostBody('/export/jobs')).toMatchObject({
      type: 'drives', format: 'csv', vehicle_id: 1,
    }));

    fireEvent.change(selector, { target: { value: '' } });
    expect(selector).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() => expect(lastPostBody('/export/jobs')).not.toHaveProperty('vehicle_id'));
  });

  it('keeps both target selectors visible and blocks exports until vehicles load', async () => {
    let resolveVehicles!: (vehicles: Vehicle[]) => void;
    vehiclesPending = new Promise(resolve => { resolveVehicles = resolve; });
    renderPage();
    expect(screen.getByRole('combobox', { name: 'STEP 3 — select vehicle' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Vehicle' })).toBeDisabled();
    expect(screen.getAllByText('Loading').length).toBeGreaterThanOrEqual(2);
    for (const name of ['Start export', 'Start full export']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(postCalls).toEqual([]);
    await act(async () => resolveVehicles(vehiclesData));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start export' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Start full export' })).toBeEnabled();
  });

  it.each(['empty', 'error'] as const)('keeps target feedback and prevents all-vehicle submissions for an %s fleet', async state => {
    if (state === 'empty') vehiclesData = [];
    else vehiclesError = new Error('Fleet unavailable');
    renderPage();
    if (state === 'empty') {
      await waitFor(() => expect(screen.getAllByText('No vehicles available')).toHaveLength(2));
    } else {
      await waitFor(() => expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(2));
    }
    expect(screen.getByRole('combobox', { name: 'STEP 3 — select vehicle' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Vehicle' })).toBeInTheDocument();
    for (const name of ['Start export', 'Start full export']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name }));
    }
    expect(postCalls).toEqual([]);
  });

  it('retains a removed target in both forms instead of silently changing scope', async () => {
    const { queryClient } = renderPage();
    const wizard = await screen.findByRole('combobox', { name: 'STEP 3 — select vehicle' });
    await waitFor(() => expect(wizard).toHaveValue('1'));
    const account = screen.getByRole('combobox', { name: 'Vehicle' });
    await waitFor(() => expect(account).toHaveValue('1'));
    vehiclesData = [{ ...baseVehicle(), id: 2, display_name: 'Model Y' }];
    act(() => { queryClient.setQueryData(['vehicles'], vehiclesData); });
    await waitFor(() => expect(within(wizard).getByRole('option', { name: 'Unknown — #1' })).toBeInTheDocument());
    expect(wizard).toHaveValue('1');
    expect(account).toHaveValue('1');
    for (const name of ['Start export', 'Start full export']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name }));
    }
    expect(postCalls).toEqual([]);

    fireEvent.change(wizard, { target: { value: '2' } });
    fireEvent.change(account, { target: { value: '2' } });
    await waitFor(() => expect(account).toHaveValue('2'));
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start full export' }));
    await waitFor(() => {
      expect(lastPostBody('/export/jobs')).toHaveProperty('vehicle_id', 2);
      expect(lastPostBody('/export/jobs/account')).toHaveProperty('vehicle_id', 2);
    });
  });

  it.each(['99', 'invalid'])('requires an explicit replacement for unknown URL target %s', async target => {
    renderPage(`/data-export?vehicle_id=${target}`);
    const wizard = screen.getByRole('combobox', { name: 'STEP 3 — select vehicle' });
    const account = screen.getByRole('combobox', { name: 'Vehicle' });
    await waitFor(() => expect(within(wizard).getByRole('option', { name: 'Model 3' })).toBeInTheDocument());
    expect(wizard).toHaveValue(target);
    expect(account).toHaveValue(target);
    expect(within(wizard).getByRole('option', { name: `Unknown — #${target}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start export' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start full export' })).toBeDisabled();
    expect(postCalls).toEqual([]);

    fireEvent.change(wizard, { target: { value: '' } });
    fireEvent.change(account, { target: { value: 'all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start full export' }));
    await waitFor(() => {
      expect(lastPostBody('/export/jobs')).not.toHaveProperty('vehicle_id');
      expect(lastPostBody('/export/jobs/account')).toEqual({});
    });
  });

  it('keeps every history field and download action reachable without mobile hiding', async () => {
    jobsData[0].file_size = 0;
    const fullFailure = 'Export failed because the destination disk is full; free capacity before retrying this job.';
    jobsData[1].error_message = fullFailure;
    renderPage();
    const table = await screen.findByRole('table');
    const readyRow = within(table).getByRole('row', { name: /Drives CSV Ready/ });
    expect(within(readyRow).getByText('Model 3')).toBeInTheDocument();
    expect(within(readyRow).getByText('1,200')).toBeInTheDocument();
    expect(within(readyRow).getByText('0 B')).toBeInTheDocument();
    expect(within(readyRow).getByRole('button', { name: 'Download' })).toBeEnabled();
    expect(table.querySelectorAll('td.hidden, th.hidden')).toHaveLength(0);
    const failure = within(table).getByText(fullFailure);
    expect(failure).toHaveClass('whitespace-normal', 'break-words');
    expect(failure).not.toHaveClass('truncate');
    const missingSize = within(table).getByRole('row', { name: /Charging JSON Failed/ });
    expect(within(missingSize).getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Export jobs' })).toContainElement(table);
  });

  it.each([
    ['missing catalog', null],
    ['empty catalog', { type: 'drives', supports_selection: true, columns: [] }],
    ['missing columns', { type: 'drives', supports_selection: true }],
    ['missing capability', { type: 'drives', columns: [] }],
  ] satisfies [string, Partial<ExportColumnsResponse> | null][])(
    'keeps the supported column section visible for a %s without changing default exports',
    async (_case, catalog) => {
      columnsData = catalog;
      renderPage();
      const picker = await screen.findByTestId('export-column-picker');
      expect(within(picker).getByText('STEP 2½ — columns')).toBeInTheDocument();
      expect(within(picker).getByText('No export columns are available for this data type.')).toBeInTheDocument();
      expect(within(picker).queryByRole('checkbox')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
      await waitFor(() => expect(postCalls).toHaveLength(1));
      expect(lastPostBody('/export/jobs')).not.toHaveProperty('columns');
    },
  );

  it('hides the column section only when the catalog explicitly does not support selection', async () => {
    columnsData = { type: 'drives', supports_selection: false, columns: [] };
    const { queryClient } = renderPage();
    await waitFor(() => expect(queryClient.getQueryState(['export-columns', 'drives'])?.status).toBe('success'));
    expect(screen.queryByText('STEP 2½ — columns')).not.toBeInTheDocument();
    expect(screen.queryByTestId('export-column-picker')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start export' })).toBeEnabled();
  });

  it.each(['CSV', 'JSON'])('submits full backup with the supported backup job ID in %s format', async format => {
    renderPage();
    await screen.findByTestId('export-column-picker');
    fireEvent.click(screen.getByTestId('export-column-checkbox-distance_m'));
    fireEvent.click(screen.getByRole('radio', { name: 'Full backup' }));
    fireEvent.click(screen.getByRole('radio', { name: format, exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'All time', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() => expect(postCalls).toHaveLength(1));
    expect(lastPostBody('/export/jobs')).toEqual({
      type: 'backup', format: format.toLowerCase(), vehicle_id: 1,
    });
  });

  it.each(['Maintenance', 'Energy'])('preserves %s with unavailable feedback instead of submitting a rejected job', async type => {
    renderPage();
    await screen.findByTestId('export-column-picker');
    fireEvent.click(screen.getByRole('radio', { name: type }));
    expect(screen.getByRole('radio', { name: type })).toBeChecked();
    const feedback = screen.getByText('Feature not supported').closest('[role="status"]');
    expect(feedback).toHaveTextContent('This feature is not available with the current server or deployment configuration.');
    const submit = screen.getByRole('button', { name: 'Start export' });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(postCalls).toEqual([]);
    expect(screen.getByRole('button', { name: 'Start full export' })).toBeEnabled();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('CSV preview')).toBeInTheDocument();
    expect(screen.getByText('JSON preview')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Drives' }));
    expect(screen.queryByText('Feature not supported')).not.toBeInTheDocument();
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(postCalls).toHaveLength(1));
    expect(lastPostBody('/export/jobs')).toMatchObject({ type: 'drives', format: 'csv' });
  });

  it('does not request or render a column catalog for full backup', async () => {
    renderPage();
    await screen.findByTestId('export-column-picker');
    fireEvent.click(screen.getByRole('radio', { name: 'Full backup' }));
    expect(screen.queryByText('STEP 2½ — columns')).not.toBeInTheDocument();
    expect(mockedRequest.mock.calls.filter(([url]) => String(url).startsWith('/exports/columns'))
      .map(([url]) => url)).toEqual(['/exports/columns?type=drives']);
  });

  it('shows a failed column catalog independently and recovers with its own retry', async () => {
    const availableColumns = columnsData;
    columnsData = new Error('Column catalog unavailable');
    renderPage();
    expect(await screen.findByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByText('STEP 2½ — columns')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start export' })).toBeEnabled();
    expect(screen.getByText('Download my data')).toBeInTheDocument();
    columnsData = availableColumns;
    fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(await screen.findByTestId('export-column-picker')).toBeInTheDocument();
    expect(screen.getByTestId('export-column-checkbox-started_at')).toBeChecked();
    expect(screen.getByTestId('export-column-checkbox-started_at')).toBeDisabled();
  });

  it('retains catalog selections through a failed refresh and submits the same ordered allowlist', async () => {
    const { queryClient } = renderPage();
    await screen.findByTestId('export-column-picker');
    fireEvent.click(screen.getByTestId('export-column-checkbox-distance_m'));
    columnsData = new Error('Column catalog refresh failed');
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['export-columns', 'drives'] });
    });
    expect(await screen.findByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByTestId('export-column-checkbox-distance_m')).not.toBeChecked();
    expect(screen.getByTestId('export-column-checkbox-started_at')).toBeChecked();
    expect(screen.getByTestId('export-column-checkbox-started_at')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() => expect(lastPostBody('/export/jobs').columns).toEqual(['started_at', 'duration_s']));
  });

  it('uses neutral preview surfaces and a theme-aware account separator without dropping content', async () => {
    renderPage();
    const csv = await screen.findByText('CSV preview');
    const json = screen.getByText('JSON preview');
    expect(csv.parentElement?.querySelector('svg')).toHaveClass('text-[var(--text-secondary)]');
    expect(json.parentElement?.querySelector('svg')).toHaveClass('text-[var(--text-secondary)]');
    expect(screen.getByText('date,distance_m,efficiency_wh_per_m')).toBeInTheDocument();
    expect(screen.getByText('2025-01-15,45200,0.152')).toBeInTheDocument();
    const account = screen.getByRole('region', { name: 'Full account export' });
    const start = within(account).getByRole('button', { name: 'Start full export' });
    expect(start.parentElement).toHaveClass('border-[var(--border-subtle)]');
    expect(start.parentElement).not.toHaveClass('border-white/[0.06]');
    expect(within(account).getByLabelText('Start date (optional)')).toBeInTheDocument();
    expect(within(account).getByLabelText('End date (optional)')).toBeInTheDocument();
  });

  it('forwards cancellation to the jobs and vehicle reads', async () => {
    renderPage();
    await screen.findByRole('table');
    for (const url of ['/export/jobs', '/vehicles']) {
      const call = mockedRequest.mock.calls.find(([path, options]) =>
        path === url && !(options as ReqOpts | undefined)?.method);
      expect(call?.[1]?.signal).toBeInstanceOf(AbortSignal);
    }
  });
});
