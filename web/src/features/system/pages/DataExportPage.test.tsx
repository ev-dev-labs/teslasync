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
 *   5.  Custom date range is forwarded verbatim.
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
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

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
  record_count?: number;
  file_size?: number;
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
let columnsData: ExportColumnsResponse | Error;
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
  jobsError = null;
  vehiclesData = [baseVehicle()];
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
  if (url === '/vehicles') return Promise.resolve(vehiclesData);
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
  const el = screen.getByText(label).closest('.flex-1');
  if (!el) throw new Error(`no metric card for "${label}"`);
  return el as HTMLElement;
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/data-export']}>
        <ToastProvider>
          <DataExportPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetData();
  mockedRequest.mockReset();
  mockedRequest.mockImplementation((url: string, opts?: ReqOpts) => routeRequest(url, opts));
  // Keep the floating JobProgressDrawer out of the way — dismissed + no active
  // jobs means it renders nothing and never collides with page queries.
  window.localStorage.setItem('teslasync.exportDrawer.state', 'dismissed');
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('DataExportPage — Project Apex elevation', () => {
  it('renders the KPI band, export wizard and history once data resolves', async () => {
    renderPage();

    // The KPI tiles only leave their loading skeletons once the jobs query
    // resolves — gate on one of them before the synchronous assertions.
    expect(await screen.findByText('Total Exports')).toBeInTheDocument();
    expect(screen.getByText('New Export')).toBeInTheDocument();

    expect(screen.getByText('Total Size')).toBeInTheDocument();
    expect(screen.getByText('Most Exported')).toBeInTheDocument();
    expect(screen.getByText('Last Export')).toBeInTheDocument();

    expect(screen.getByText('Export History')).toBeInTheDocument();
    // Failed row surfaces its error message as visible + title text.
    expect(screen.getByText('disk full')).toBeInTheDocument();
  });

  it('aggregates the stat tiles from job data (count, summed bytes, top type)', async () => {
    renderPage();
    await screen.findByText('Total Exports');

    // 3 jobs total.
    expect(within(metricCard('Total Exports')).getByText('3')).toBeInTheDocument();
    // 2048 + 0 + 5_000_000 bytes → "4.8 MB".
    expect(within(metricCard('Total Size')).getByText('4.8 MB')).toBeInTheDocument();
    // drives x2 beats charging x1 — rendered lower-cased from the type key.
    expect(within(metricCard('Most Exported')).getByText('drives')).toBeInTheDocument();
  });

  it('submits a new export with the chosen type, format and default 30-day window', async () => {
    renderPage();
    await screen.findByText('New Export');

    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Charging' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start Export' }));

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
    await screen.findByText('New Export');

    fireEvent.click(screen.getByRole('button', { name: 'All Time' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start Export' }));

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
    await screen.findByText('New Export');

    fireEvent.click(screen.getByRole('button', { name: 'Custom Range' }));
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2025-03-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start Export' }));

    await waitFor(() => {
      expect(postCalls.some((c) => c.url === '/export/jobs')).toBe(true);
    });

    const body = lastPostBody('/export/jobs');
    expect(body.start).toBe('2025-03-01');
    // End defaults to "today" when left blank.
    expect(typeof body.end).toBe('string');
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
    fireEvent.click(screen.getByRole('button', { name: 'Start Export' }));

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

    expect(await screen.findByText('No Exports Yet')).toBeInTheDocument();
    expect(screen.getByText('Create your first export above to get started.')).toBeInTheDocument();
    expect(within(metricCard('Total Exports')).getByText('0')).toBeInTheDocument();
  });

  it('surfaces a load-error banner without crashing the rest of the page', async () => {
    jobsError = new Error('boom: 500 Internal');
    renderPage();

    expect(await screen.findByText('Failed to load export jobs')).toBeInTheDocument();
    // The wizard (fed by the still-successful vehicles query) keeps working.
    expect(screen.getByText('New Export')).toBeInTheDocument();
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
    expect(await screen.findByText('XML')).toBeInTheDocument();
    expect(screen.getByText('777')).toBeInTheDocument();
    expect(screen.getByText('888')).toBeInTheDocument();
  });

  it('gates the scheduled-exports section behind auth mode (open mode → placeholder)', async () => {
    renderPage();
    await screen.findByText('New Export');

    // In open mode the RequiresAuth wrapper renders its stable placeholder and
    // never mounts the underlying scheduled-exports panel.
    expect(screen.getByTestId('requires-auth-empty-session_list')).toBeInTheDocument();
    expect(
      mockedRequest.mock.calls.some((c) => c[0] === '/scheduled-exports'),
    ).toBe(false);
  });
});
