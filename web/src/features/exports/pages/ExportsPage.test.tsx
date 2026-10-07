/**
 * ExportsPage — behaviour + hardening coverage.
 *
 * ExportsPage exposes a single default export (the exports command view). This
 * suite drives it through every meaningful branch by mocking only its two data
 * hooks (`useExportJobs` / `useBulkExportsDelete`) and the opt-in AI advisor.
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
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ApiError } from '@/lib/resilience';
import type { ExportJobSummary } from '@/api/hooks/useExports';

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
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
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

 
function makeQuery(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
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
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ExportsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const kpiRegion = () => screen.getByRole('region', { name: 'Export summary' });

/** Read the MetricCard value <p> that immediately follows its label span. */
function kpiValue(label: string): string {
  const span = within(kpiRegion()).getByText(label);
  return span.closest('p')?.nextElementSibling?.textContent ?? '';
}

beforeEach(() => {
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
    expect(screen.getByText('Export Jobs')).toBeInTheDocument();
    expect(screen.getByText('Status Breakdown')).toBeInTheDocument();
    // …but the data surfaces are withheld while loading.
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('No exports yet')).toBeNull();
    // KPI cards are replaced by skeletons (no card label rendered).
    expect(screen.queryByText('Total Exports')).toBeNull();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
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
    expect(kpiValue('Total Exports')).toBe('0');
  });
});

describe('ExportsPage — populated', () => {
  it('derives honest KPI tiles from the fixture', () => {
    renderPage();
    expect(kpiValue('Total Exports')).toBe('6');
    expect(kpiValue('Ready')).toBe('2');
    expect(kpiValue('In Progress')).toBe('2');
    expect(kpiValue('Failed')).toBe('1');
    expect(kpiValue('Total Size')).toBe('5.0 MB');
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
    expect(screen.getByText('Storage Used')).toBeInTheDocument();
    // 5.0 MB shows in BOTH the KPI card and the breakdown footer.
    expect(screen.getAllByText('5.0 MB').length).toBeGreaterThanOrEqual(2);
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
    expect(within(table).getByText('1.0 KB')).toBeInTheDocument();
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
});
