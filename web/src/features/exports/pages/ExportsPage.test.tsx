/**
 * ExportsPage — behaviour + hardening coverage.
 *
 * ExportsPage exposes a single default export (the exports command view). This
 * suite controls its two data hooks (`useExportJobs` / `useBulkExportsDelete`),
 * the opt-in AI advisor, and external CSV/JSON download actions.
 * The derived-stats library (`../components/exportStats`), the shared
 * `<DataTable>`, the promise-based confirm dialog (`useConfirm` +
 * `<ConfirmDialog>`), the number/date formatters, and the download-URL builder
 * (`exportDownloadUrl`, kept REAL via `importActual`) are the genuine
 * implementations, so KPI maths, the status breakdown, the selection flow, and
 * the /api/v1 artifact-URL contract are all really exercised. Network is never
 * touched.
 *
 * Facets covered:
 *   - loading: KPI + jobs + breakdown show skeletons; the table and the
 *     "no exports" empty state never flash.
 *   - error: both the jobs panel and the breakdown surface a 5xx QueryError
 *     whose Retry re-invokes the query's refetch; the table is withheld.
 *   - empty: the jobs empty-state placeholder renders (never a blank panel) and
 *     the KPI band still shows honest zeros.
 *   - populated: honest KPI tiles derived from the fixture, a legible status
 *     badge per row, a download link ONLY for ready jobs (with the /api/v1
 *     artifact URL), the AI advisor slot, and the storage footprint.
 *   - cell null-safety: a job with blank type/format renders the "—" glyph in
 *     those cells instead of an empty cell (the hardening guard).
 *   - bulk delete happy path: select → confirm → mutateAsync called with the
 *     stringified id; selection clears afterwards.
 *   - bulk delete cancel: dismissing the confirm dialog never calls the mutation.
 *   - bulk delete failure: a rejected mutation is swallowed (no unhandled
 *     rejection) and the multi-select is PRESERVED so the user can retry.
 *   - refresh: the header refresh control re-invokes the query's refetch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ApiError } from '@/lib/resilience';
import type { ExportBulkResult, ExportJobSummary } from '@/api/hooks/useExports';
import { downloadCSV, downloadJSON } from '@/lib/csvExport';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { decimal_precision: 2, locale: 'en-US', unit_of_length: 'km',
      unit_of_temp: 'C', unit_of_pressure: 'bar', currency_symbol: '$' },
    settingsUnavailable: false,
  }),
}));

// ── i18n stub: resolve the fallback string (2nd arg) and interpolate {{var}}. ──
vi.mock('react-i18next', () => {
  const interpolate = (str: string, vars?: Record<string, unknown> | null): string => {
    if (!vars) return str;
    let s = str;
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return s;
  };
  const t = (key: string, second?: unknown, third?: unknown): string => {
    if (typeof second === 'string') {
      return interpolate(
        second,
        third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined,
      );
    }
    if (second && typeof second === 'object') {
      const bag = second as Record<string, unknown>;
      const tpl = typeof bag.defaultValue === 'string' ? bag.defaultValue : key;
      return interpolate(tpl, bag);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── framer-motion: strip animation props, keep motion.* + useReducedMotion. ──
vi.mock('framer-motion', () => {
  type MotionProps = { children?: ReactNode } & Record<string, unknown>;
  const elements = new Map<PropertyKey, (props: MotionProps) => ReactNode>();
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_target, tag) => {
        const cached = elements.get(tag);
        if (cached) return cached;
        const Component = ({ children, ...rest }: MotionProps) => {
          const safe: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (
              [
                'animate',
                'initial',
                'exit',
                'transition',
                'whileHover',
                'whileTap',
                'whileInView',
                'viewport',
                'variants',
              ].includes(k)
            )
              continue;
            safe[k] = v;
          }
          return <div {...(safe as Record<string, unknown>)}>{children}</div>;
        };
        elements.set(tag, Component);
        return Component;
      },
    },
  );
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReducedMotion: () => true,
  };
});

// ── The opt-in AI advisor pulls its own settings/stream wiring; stub it to a
//    sentinel so this suite stays focused on the page's own orchestration. ──
vi.mock('@/components/ai/AIPiiRedactionSharedExports', () => ({
  AIPiiRedactionSharedExports: () => <div data-testid="ai-advisor-stub" />,
}));

vi.mock('@/lib/csvExport', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/csvExport')>(),
  downloadCSV: vi.fn(),
  downloadJSON: vi.fn(),
}));

// ── Data hooks, driven per test. `exportDownloadUrl` + the stats helpers stay
//    REAL so the artifact-URL contract and KPI maths are genuinely exercised. ──
vi.mock('@/api/hooks/useExports', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useExports')>(
    '@/api/hooks/useExports',
  );
  return {
    ...actual,
    useExportJobs: vi.fn(),
    useBulkExportsDelete: vi.fn(),
  };
});

import { useExportJobs, useBulkExportsDelete } from '@/api/hooks/useExports';
import ExportsPage from './ExportsPage';

const mockJobs = useExportJobs as unknown as ReturnType<typeof vi.fn>;
const mockBulkDelete = useBulkExportsDelete as unknown as ReturnType<typeof vi.fn>;

interface QueryStub {
  data: ExportJobSummary[] | undefined;
  error: Error | null;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  fetchStatus: 'idle' | 'fetching' | 'paused';
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeQuery(over: Partial<QueryStub> = {}): QueryStub {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    fetchStatus: 'idle',
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function job(
  over: Partial<ExportJobSummary> & Pick<ExportJobSummary, 'id' | 'status'>,
): ExportJobSummary {
  return {
    type: 'drives',
    format: 'csv',
    created_at: '2026-04-24T15:00:00Z',
    ...over,
  } as ExportJobSummary;
}

const MB = 1024 * 1024;

// 6 jobs: 2 ready (2MB + 3MB = 5.0 MB), 1 processing, 1 queued, 1 failed, 1 expired.
const JOBS: ExportJobSummary[] = [
  job({ id: 'job-ready-1', type: 'drives', format: 'csv', status: 'ready', file_size: 2 * MB }),
  job({
    id: 'job-ready-2',
    type: 'charging',
    format: 'json',
    status: 'ready',
    file_size: 3 * MB,
    created_at: '2026-04-23T10:00:00Z',
  }),
  job({ id: 'job-proc', type: 'trips', format: 'csv', status: 'processing', created_at: '2026-04-22T10:00:00Z' }),
  job({ id: 'job-queued', type: 'analytics', format: 'zip', status: 'queued', created_at: '2026-04-21T10:00:00Z' }),
  job({ id: 'job-failed', type: 'backup', format: 'zip', status: 'failed', created_at: '2026-04-20T10:00:00Z' }),
  job({ id: 'job-expired', type: 'account', format: 'csv', status: 'expired', created_at: '2026-04-19T10:00:00Z' }),
];

let mutateAsyncSpy: ReturnType<typeof vi.fn>;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ExportsPage />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const result = render(tree());
  return { ...result, rerenderPage: () => result.rerender(tree()) };
}

const kpiRegion = () => screen.getByRole('region', { name: 'Export summary' });

function drawerFooter(drawer: HTMLElement) {
  const footer = drawer.querySelector('[data-drawer-footer]');
  if (!footer) throw new Error('Export summary drawer footer is missing');
  return within(footer);
}

/** Read the actual Brief value without relying on typography siblings. */
function kpiValue(label: string): string {
  const span = within(kpiRegion()).getByText(label);
  return span.closest('[data-operational-metric]')?.querySelector('[data-operational-value]')?.textContent ?? '';
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(downloadCSV).mockReset();
  vi.mocked(downloadJSON).mockReset();
  mockJobs.mockReset();
  mockBulkDelete.mockReset();
  mutateAsyncSpy = vi.fn().mockResolvedValue({ deleted: 1, failed: [] });
  mockBulkDelete.mockReturnValue({
    mutateAsync: mutateAsyncSpy,
    mutate: vi.fn(),
    isPending: false,
  });
  mockJobs.mockReturnValue(makeQuery({ data: JOBS }));
});

describe('ExportsPage — loading', () => {
  it('shows skeletons and never flashes the table or the empty state', () => {
    mockJobs.mockReturnValue(makeQuery({ isLoading: true, data: undefined }));
    const { container } = renderPage();

    // Panel scaffolding is always present…
    expect(screen.getByText('Export jobs')).toBeInTheDocument();
    expect(screen.getByText('Status breakdown')).toBeInTheDocument();
    // …but the data surfaces are withheld while loading.
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('No exports yet')).toBeNull();
    // Summary labels remain visible, but no measured values flash.
    expect(screen.getByText('Total exports')).toBeInTheDocument();
    expect(kpiRegion()).toHaveAttribute('aria-busy', 'true');
    expect(kpiRegion().querySelector('[data-operational-value]')).toBeNull();
    expect(container.querySelectorAll('[class*="--skeleton-bg"]').length).toBeGreaterThan(0);
  });
});

describe('ExportsPage — error', () => {
  it('surfaces a QueryError in both panels and Retry re-invokes refetch', () => {
    const refetch = vi.fn();
    mockJobs.mockReturnValue(
      makeQuery({ error: new ApiError('Boom', 500), isError: true, data: undefined, refetch }),
    );
    renderPage();

    // Both the jobs panel and the breakdown render the 5xx QueryError.
    expect(screen.getAllByText('Server error')).toHaveLength(2);
    expect(screen.queryByRole('table')).toBeNull();

    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(2);
    fireEvent.click(retries[0]);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('ExportsPage — empty', () => {
  it('renders the jobs empty-state placeholder instead of a blank panel', () => {
    mockJobs.mockReturnValue(makeQuery({ data: [] }));
    renderPage();

    expect(screen.getByText('No exports yet')).toBeInTheDocument();
    expect(
      screen.getByText('Your future exports will appear here for download or deletion.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    // Post-load the KPI band shows honest zeros, not skeletons.
    expect(kpiValue('Total exports')).toBe('0');
  });
});

describe('ExportsPage — populated', () => {
  it('reviews all summary captions without changing table rows, selection or any job', async () => {
    const snapshot = structuredClone(JOBS);
    renderPage();
    fireEvent.click(within(screen.getByRole('table')).getAllByRole('checkbox', { name: /export,/ })[0]);
    const trigger = within(kpiRegion()).getByRole('button', { name: 'Review details' });
    trigger.focus();
    fireEvent.click(trigger);
    const drawer = await screen.findByRole('dialog', { name: 'Export summary details' });
    expect(within(drawer).getByText('Every job in the returned list, including expired jobs and unrecognized statuses.')).toBeInTheDocument();
    expect(within(drawer).getByText('Jobs marked ready in the returned list; their download actions remain in the jobs table.')).toBeInTheDocument();
    expect(within(drawer).getByText('Queued and processing jobs combined; this is not a completion estimate.')).toBeInTheDocument();
    expect(within(drawer).getByText('Jobs marked failed in the returned list, not a failure rate or a date-bounded total.')).toBeInTheDocument();
    expect(within(drawer).getByText('5.00 MB')).toBeInTheDocument();
    fireEvent.click(drawerFooter(drawer).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByRole('checkbox', { name: /export,/ })).toHaveLength(6);
    expect(screen.getByRole('link', { name: 'Download export job-ready-1' })).toHaveAttribute('href', '/api/v1/export/jobs/job-ready-1/download');
    expect(JOBS).toEqual(snapshot);
    expect(mutateAsyncSpy).not.toHaveBeenCalled();
  });

  it('derives honest KPI tiles from the fixture', () => {
    renderPage();
    expect(kpiValue('Total exports')).toBe('6');
    expect(kpiValue('Ready')).toBe('2');
    expect(kpiValue('In progress')).toBe('2');
    expect(kpiValue('Failed')).toBe('1');
    expect(kpiValue('Total size')).toBe('5.00 MB');
  });

  it('renders a selectable row per job with a download link ONLY for ready jobs', () => {
    renderPage();
    const table = screen.getByRole('table');

    // One selection checkbox per data row → all six jobs rendered.
    // Row checkboxes are named after the job, not its UUID (A11Y):
    // "drives export, 22 Apr 2026". One per data row → all six rendered.
    expect(within(table).getAllByRole('checkbox', { name: /export,/ })).toHaveLength(6);

    // Ready jobs expose a download <a> pointing at the /api/v1 artifact URL.
    const dl = screen.getByRole('link', { name: 'Download export job-ready-1' });
    expect(dl).toHaveAttribute('href', '/api/v1/export/jobs/job-ready-1/download');
    expect(dl).toHaveAttribute('download');
    // Exactly the two ready jobs get a link; the other four do not.
    expect(screen.getAllByRole('link')).toHaveLength(2);

    // Status is legible as text (not colour-only) in every row.
    expect(within(table).getAllByText('ready')).toHaveLength(2);
    expect(within(table).getByText('failed')).toBeInTheDocument();
    expect(within(table).getByText('processing')).toBeInTheDocument();
  });

  it('mounts the opt-in AI advisor slot and the storage breakdown', () => {
    renderPage();
    expect(screen.getByTestId('ai-advisor-stub')).toBeInTheDocument();
    // Storage footprint appears in the breakdown panel's "Storage Used" row.
    expect(screen.getByText('Storage used')).toBeInTheDocument();
    expect(screen.getAllByText('5.00 MB').length).toBeGreaterThanOrEqual(2);
  });
});

describe('ExportsPage — cell null-safety', () => {
  it('renders the "—" glyph for a job with blank type/format', () => {
    mockJobs.mockReturnValue(
      makeQuery({
        data: [job({ id: 'j1', type: '', format: '', status: 'ready', file_size: 1024 })],
      }),
    );
    renderPage();
    const table = screen.getByRole('table');

    // Only the type + format cells fall back to the em-dash; size + actions
    // render real content (KB + a download link), so exactly two dashes.
    expect(within(table).getAllByText('—')).toHaveLength(2);
    expect(within(table).getByText('1.00 KB')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download export j1' })).toBeInTheDocument();
  });
});

describe('ExportsPage — bulk delete', () => {
  it('selects a job, confirms, and calls the mutation with the stringified id', async () => {
    renderPage();
    const table = screen.getByRole('table');

    fireEvent.click(within(table).getAllByRole('checkbox', { name: /export,/ })[0]);
    expect(await screen.findByText('1 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete export jobs?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mutateAsyncSpy).toHaveBeenCalledWith(['job-ready-1']));
    // Selection clears on success.
    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull());
  });

  it('does not call the mutation when the confirm dialog is cancelled', async () => {
    renderPage();
    const table = screen.getByRole('table');
    fireEvent.click(within(table).getAllByRole('checkbox', { name: /export,/ })[0]);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mutateAsyncSpy).not.toHaveBeenCalled();
  });

  it('preserves the selection when the bulk delete fails (no unhandled rejection)', async () => {
    mutateAsyncSpy.mockRejectedValueOnce(new Error('server exploded'));
    renderPage();
    const table = screen.getByRole('table');
    fireEvent.click(within(table).getAllByRole('checkbox', { name: /export,/ })[0]);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mutateAsyncSpy).toHaveBeenCalledWith(['job-ready-1']));
    // The rejection is swallowed and the multi-select survives for a retry.
    expect(await screen.findByText('1 selected')).toBeInTheDocument();
  });
});

describe('ExportsPage — refresh', () => {
  it('re-invokes the query refetch when the header refresh control is used', () => {
    const refetch = vi.fn();
    mockJobs.mockReturnValue(makeQuery({ data: JOBS, refetch }));
    renderPage();

    const refreshers = screen.getAllByRole('button', { name: 'Refresh' });
    expect(refreshers.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(refreshers[refreshers.length - 1]);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('retains all jobs, summary, download links and selected members when a refresh fails', () => {
    const query = makeQuery({ data: JOBS });
    mockJobs.mockReturnValue(query);
    const view = renderPage();
    const table = screen.getByRole('table');
    fireEvent.click(within(table).getAllByRole('checkbox', { name: /export,/ })[0]);
    query.error = new Error('background failure');
    query.isError = true;
    view.rerenderPage();
    expect(kpiValue('Total exports')).toBe('6');
    expect(within(screen.getByRole('table')).getAllByRole('checkbox', { name: /export,/ })).toHaveLength(6);
    expect(screen.getByRole('link', { name: 'Download export job-ready-1' })).toBeInTheDocument();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.queryByText('Server error')).not.toBeInTheDocument();
    expect(screen.getByText('Storage used')).toBeInTheDocument();
    expect(within(kpiRegion()).getByText('Retained export jobs')).toBeInTheDocument();
    expect(kpiRegion().querySelector('[data-operational-metric="storage"]')).toHaveAttribute('data-value-state', 'value');
    expect(within(kpiRegion()).getByText(/Last successful load:/)).toBeInTheDocument();
  });

  it('does not substitute zero totals when the initial source failed', () => {
    mockJobs.mockReturnValue(makeQuery({ data: undefined, error: new Error('offline'), isError: true }));
    renderPage();
    const region = kpiRegion();
    const total = within(region).getByText('Total exports').closest('[data-operational-metric]');
    expect(total).toHaveAttribute('data-value-state', 'missing');
    expect(kpiValue('Total exports')).toBe('—');
    expect(within(kpiRegion()).getByText('Export-job source failed')).toBeInTheDocument();
    expect(screen.getByTestId('ai-advisor-stub')).toBeInTheDocument();
  });

  it('keeps retained raw counts, byte units, downloads and the real drawer when refresh is paused', async () => {
    mockJobs.mockReturnValue(makeQuery({ data: JOBS, fetchStatus: 'paused' }));
    renderPage();
    expect(within(kpiRegion()).getByText('Retained jobs · refresh paused')).toBeInTheDocument();
    expect(kpiValue('Total exports')).toBe('6');
    expect(kpiValue('Total size')).toBe('5.00 MB');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(within(kpiRegion()).getByRole('button', { name: 'Review details' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Retained jobs · refresh paused')).toBeInTheDocument();
    expect(within(drawer).getByText('5.00 MB')).toBeInTheDocument();
    fireEvent.click(drawerFooter(drawer).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Download export job-ready-1' })).toBeInTheDocument();
    expect(mutateAsyncSpy).not.toHaveBeenCalled();
  });

  it.each([
    { fetchStatus: 'paused' as const, message: 'The export-job query is paused; no empty result is inferred.' },
    { fetchStatus: 'idle' as const, message: 'Export-job availability has not resolved yet.' },
  ])('does not infer empty exports or zero totals from an initial $fetchStatus source', ({ fetchStatus, message }) => {
    mockJobs.mockReturnValue(makeQuery({ fetchStatus }));
    renderPage();
    expect(screen.getAllByText(message)).toHaveLength(2);
    expect(kpiValue('Total exports')).toBe('—');
    expect(screen.queryByText('No exports yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Storage used')).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-advisor-stub')).toBeInTheDocument();
    expect(within(kpiRegion()).getByText(fetchStatus === 'paused'
      ? 'Export-job source paused' : 'Export-job source unresolved')).toBeInTheDocument();
  });

  describe('ExportsPage — recovery interactions', () => {
    it('recovers through retry, pending and ready states without flashing empty jobs or running a mutation', () => {
      const refetch = vi.fn();
      mockJobs.mockReturnValue(makeQuery({
        error: new ApiError('unavailable', 503), isError: true, refetch,
      }));
      const view = renderPage();
      fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
      expect(refetch).toHaveBeenCalledOnce();

      mockJobs.mockReturnValue(makeQuery({
        isLoading: true, isFetching: true, fetchStatus: 'fetching', refetch,
      }));
      view.rerenderPage();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.queryByText('No exports yet')).not.toBeInTheDocument();
      expect(screen.getByTestId('ai-advisor-stub')).toBeInTheDocument();

      mockJobs.mockReturnValue(makeQuery({ data: JOBS, refetch }));
      view.rerenderPage();
      expect(screen.getByRole('table', { name: 'exports:jobs' })).toBeInTheDocument();
      expect(kpiValue('Total exports')).toBe('6');
      expect(screen.queryByText('Service unavailable')).not.toBeInTheDocument();
      expect(mutateAsyncSpy).not.toHaveBeenCalled();
    });

    it('keeps permission guidance separate from empty exports and recovers after access is restored', () => {
      const refetch = vi.fn();
      mockJobs.mockReturnValue(makeQuery({
        error: new ApiError('forbidden', 403), isError: true, refetch,
      }));
      const view = renderPage();
      expect(screen.getAllByText('Permission denied')).toHaveLength(2);
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
      expect(screen.queryByText('No exports yet')).not.toBeInTheDocument();
      expect(kpiValue('Total exports')).toBe('—');

      fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' }).at(-1)!);
      expect(refetch).toHaveBeenCalledOnce();
      mockJobs.mockReturnValue(makeQuery({ data: JOBS, refetch }));
      view.rerenderPage();
      expect(screen.queryByText('Permission denied')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Download export job-ready-1' }))
        .toHaveAttribute('href', '/api/v1/export/jobs/job-ready-1/download');
      expect(mutateAsyncSpy).not.toHaveBeenCalled();
    });

    it('preserves exact selected members after a denied deletion and requires a fresh confirmation for retry', async () => {
      mutateAsyncSpy
        .mockRejectedValueOnce(new ApiError('forbidden', 403))
        .mockResolvedValueOnce({ deleted: 2, failed: [] });
      renderPage();
      const checkboxes = within(screen.getByRole('table')).getAllByRole('checkbox', { name: /export,/ });
      fireEvent.click(checkboxes[0]);
      fireEvent.click(checkboxes[1]);
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(mutateAsyncSpy).not.toHaveBeenCalled();
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(mutateAsyncSpy).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByText('2 selected')).toBeInTheDocument();
      expect(checkboxes[0]).toBeChecked();
      expect(checkboxes[1]).toBeChecked();

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      const retryDialog = await screen.findByRole('dialog');
      expect(within(retryDialog).getByText(
        'Selected jobs and their downloadable artifacts will be permanently removed.',
      )).toBeInTheDocument();
      expect(mutateAsyncSpy).toHaveBeenCalledTimes(1);
      fireEvent.click(within(retryDialog).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(screen.queryByText('2 selected')).not.toBeInTheDocument());
      expect(mutateAsyncSpy.mock.calls).toEqual([
        [['job-ready-1', 'job-ready-2']],
        [['job-ready-1', 'job-ready-2']],
      ]);
    });

    it('keeps the selected rows and disables repeated deletion while the confirmed request is pending', async () => {
      let resolveDelete: ((result: ExportBulkResult) => void) | undefined;
      mutateAsyncSpy.mockImplementation(() => new Promise<ExportBulkResult>((resolve) => {
        resolveDelete = resolve;
      }));
      const view = renderPage();
      fireEvent.click(within(screen.getByRole('table')).getAllByRole('checkbox', { name: /export,/ })[0]);
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(mutateAsyncSpy).toHaveBeenCalledOnce());

      mockBulkDelete.mockReturnValue({ mutateAsync: mutateAsyncSpy, isPending: true });
      view.rerenderPage();
      const deleteButton = screen.getByRole('button', { name: 'Delete' });
      expect(deleteButton).toBeDisabled();
      expect(deleteButton).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByText('1 selected')).toBeInTheDocument();
      fireEvent.click(deleteButton);
      expect(mutateAsyncSpy).toHaveBeenCalledOnce();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await act(async () => {
        if (!resolveDelete) throw new Error('Confirmed delete did not start');
        resolveDelete({ deleted: 1, failed: [] });
      });
      mockBulkDelete.mockReturnValue({ mutateAsync: mutateAsyncSpy, isPending: false });
      view.rerenderPage();
      expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('treats Escape as cancellation, keeps selection and reopens confirmation without mutating', async () => {
      renderPage();
      fireEvent.click(within(screen.getByRole('table')).getAllByRole('checkbox', { name: /export,/ })[0]);
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      await screen.findByRole('dialog');
      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByText('1 selected')).toBeInTheDocument();
      expect(mutateAsyncSpy).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(mutateAsyncSpy).not.toHaveBeenCalled();
    });
  });

  describe('ExportsPage — complete loaded exports and settings', () => {
    it('exports every matching loaded row rather than only the first page, and selection exports only the chosen members', async () => {
      const jobs = Array.from({ length: 31 }, (_, index) => job({
        id: `job-${index}`, type: `export-${index}`, status: 'ready', file_size: index * 1024,
      }));
      const snapshot = structuredClone(jobs);
      mockJobs.mockReturnValue(makeQuery({ data: jobs }));
      renderPage();
      const checkboxes = within(screen.getByRole('table')).getAllByRole('checkbox', { name: /export,/ });
      expect(checkboxes).toHaveLength(25);
      fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
      await waitFor(() => expect(downloadJSON).toHaveBeenCalledOnce());
      expect(vi.mocked(downloadJSON).mock.calls[0][1]).toEqual(jobs.map((row) => ({
        type: row.type, format: 'csv', file_size: row.file_size,
        created_at: row.created_at, status: 'ready', actions: 'Download',
      })));

      await waitFor(() => expect(screen.getByRole('button', { name: 'Export list' })).not.toBeDisabled());
      fireEvent.click(checkboxes[0]);
      fireEvent.click(checkboxes[1]);
      fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
      expect(screen.getByRole('menuitemradio', { name: 'Selected (2)' })).toHaveAttribute('aria-checked', 'true');
      fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
      await waitFor(() => expect(downloadJSON).toHaveBeenCalledTimes(2));
      expect(vi.mocked(downloadJSON).mock.calls[1][1]).toEqual([
        { type: 'export-0', format: 'csv', file_size: 0, created_at: jobs[0].created_at, status: 'ready', actions: 'Download' },
        { type: 'export-1', format: 'csv', file_size: 1024, created_at: jobs[1].created_at, status: 'ready', actions: 'Download' },
      ]);

      await waitFor(() => expect(screen.getByRole('button', { name: 'Export list' })).not.toBeDisabled());
      fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Visible (31)' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Download as CSV' }));
      await waitFor(() => expect(downloadCSV).toHaveBeenCalledOnce());
      const csv = vi.mocked(downloadCSV).mock.calls[0][1];
      expect(csv.split('\r\n')).toHaveLength(32);
      expect(csv.split('\r\n')[0]).toBe('Type,Format,Size,Created,Status,Actions');
      jobs.forEach((row) => expect(csv).toContain(`${row.type},csv,`));
      expect(jobs).toEqual(snapshot);
      expect(mutateAsyncSpy).not.toHaveBeenCalled();
    });

    it('keeps actual column choices under exports:jobs across refresh failure and remount, including exported column order', async () => {
      const view = renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Reorder or hide columns' }));
      const menu = screen.getByRole('menu', { name: 'Reorder or hide columns' });
      fireEvent.click(within(menu).getByRole('checkbox', { name: 'Show or hide Format' }));
      fireEvent.click(within(menu).getByRole('button', { name: 'Move Type down' }));
      fireEvent.click(within(menu).getByRole('button', { name: 'Move Size up' }));
      fireEvent.keyDown(document, { key: 'Escape' });
      const saved = window.localStorage.getItem('teslasync.table.exports:jobs.columns');
      expect(JSON.parse(saved ?? 'null')).toEqual({
        order: ['format', 'file_size', 'type', 'created_at', 'status', 'actions'],
        hidden: ['format'],
      });
      expect(within(screen.getByRole('table')).queryByRole('columnheader', { name: /Format/ }))
        .not.toBeInTheDocument();

      mockJobs.mockReturnValue(makeQuery({ data: JOBS, error: new Error('refresh failed'), isError: true }));
      view.rerenderPage();
      expect(window.localStorage.getItem('teslasync.table.exports:jobs.columns')).toBe(saved);
      expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
      await waitFor(() => expect(downloadJSON).toHaveBeenCalledOnce());
      const exported = vi.mocked(downloadJSON).mock.calls[0][1] as Record<string, unknown>[];
      expect(exported).toHaveLength(JOBS.length);
      expect(Object.keys(exported[0])).toEqual(['file_size', 'type', 'created_at', 'status', 'actions']);
      expect(exported.every((row) => !('format' in row))).toBe(true);
      view.unmount();
      renderPage();
      expect(within(screen.getByRole('table')).queryByRole('columnheader', { name: /Format/ }))
        .not.toBeInTheDocument();
      expect(window.localStorage.getItem('teslasync.table.exports:jobs.columns')).toBe(saved);
    });
  });
});
