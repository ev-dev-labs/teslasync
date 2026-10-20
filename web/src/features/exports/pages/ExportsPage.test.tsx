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
import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ApiError } from '@/lib/resilience';
import type { ExportBulkResult, ExportJobSummary } from '@/api/hooks/useExports';
import { downloadCSV, downloadJSON } from '@/lib/csvExport';
import { BUTTON_BASE, BUTTON_VARIANTS } from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';

const datePreferences = vi.hoisted(() => ({
  locale: 'en-US',
  timezone_user: 'UTC',
  tz_display_default: 'user',
}));
const translations = vi.hoisted(() => ({} as Record<string, string>));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { decimal_precision: 2, unit_of_length: 'km',
      unit_of_temp: 'C', unit_of_pressure: 'bar', currency_symbol: '$', ...datePreferences },
    locale: datePreferences.locale,
    settingsUnavailable: false,
  }),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: null }),
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
    if (translations[key] !== undefined) return translations[key];
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

describe('ExportsPage — phase-five contract adoption', () => {
  it('embeds the jobs grid without losing its toolbar, contained scroll, fields or pagination', () => {
    mockJobs.mockReturnValue(makeQuery({
      data: Array.from({ length: 26 }, (_, index) => job({
        id: `embedded-${index}`,
        type: `export-${index}`,
        status: 'ready',
        file_size: MB,
      })),
    }));
    const { container } = renderPage();
    const frame = container.querySelector('[data-grid-frame]');
    expect(frame).toHaveAttribute('data-grid-variant', 'embedded');
    expect(frame).toHaveClass('min-w-0', 'max-w-full');
    const viewport = frame?.querySelector('[data-grid-viewport]');
    expect(viewport).toHaveStyle({ maxHeight: '640px' });
    expect(viewport).toHaveClass('overflow-auto');
    expect(frame?.querySelector('[data-grid-footer]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export list' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Export jobs' });
    for (const label of ['Type', 'Format', 'Size', 'Created', 'Status', 'Actions']) {
      expect(within(table).getByRole('columnheader', { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(table.querySelector('thead tr')).toHaveClass('sticky');
    expect(within(table).getAllByRole('checkbox', { name: /export,/ })).toHaveLength(25);
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(within(table).getAllByRole('checkbox', { name: /export,/ })).toHaveLength(1);
    expect(within(table).getByText('export-25')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Download export embedded-25' }))
      .toHaveAttribute('href', '/api/v1/export/jobs/embedded-25/download');
    fireEvent.click(within(table).getByRole('checkbox', { name: /export,/ }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('retains native ready downloads with shared semantic focus chrome and mobile action targets', () => {
    renderPage();
    const link = screen.getByRole('link', { name: 'Download export job-ready-1' });
    expect(link).toHaveAttribute('href', '/api/v1/export/jobs/job-ready-1/download');
    expect(link).toHaveAttribute('download');
    expect(link).toHaveClass(...BUTTON_BASE.split(' '), ...BUTTON_VARIANTS.ghost.split(' '));
    expect(link).toHaveClass('min-h-11', 'min-w-11');
    expect(link.className).not.toMatch(/cyan-|white\/|text-sm/);
    expect(screen.getAllByRole('button', { name: 'Refresh' }).at(-1)).toHaveClass('min-h-11', 'min-w-11');
    expect(mutateAsyncSpy).not.toHaveBeenCalled();
  });

  it.each([
    { case: 'partial deletion', deleted: 1, failed: [{ id: 'job-ready-2', reason: 'not_found' }] },
    { case: 'no deleted jobs', deleted: 0, failed: [
      { id: 'job-ready-1', reason: 'not_found' },
      { id: 'job-ready-2', reason: 'not_found' },
    ] },
    { case: 'mixed known and unknown reason codes', deleted: 0, failed: [
      { id: 'job-ready-1', reason: 'timeout' },
      { id: 'job-ready-2', reason: 'not_found' },
    ] },
  ])('retains failed members and reported reasons after $case', async ({ deleted, failed }) => {
    mutateAsyncSpy.mockResolvedValueOnce({ deleted, failed });
    renderPage();
    const checkboxes = within(screen.getByRole('table')).getAllByRole('checkbox', { name: /export,/ });
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mutateAsyncSpy).toHaveBeenCalledWith(['job-ready-1', 'job-ready-2']);
    expect(screen.getByText(`${failed.length} selected`)).toBeInTheDocument();
    expect(checkboxes[0]).toHaveProperty('checked', deleted === 0);
    expect(checkboxes[1]).toBeChecked();
    expect(screen.getByText('Failed to delete exports')).toBeInTheDocument();
    // Verified-missing jobs explain themselves; future codes fall back to an
    // honest unknown label that retains the raw reason for diagnostics.
    failed.forEach(({ id, reason }) => expect(screen.getByText(
      reason === 'not_found' ? `${id}: Already deleted` : `${id}: Unknown failure: ${reason}`,
    )).toBeInTheDocument());
    expect(kpiValue('Total exports')).toBe('6');
    expect(screen.getByText('Status breakdown')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mutateAsyncSpy).toHaveBeenCalledOnce();
    expect(screen.getByText(`${failed.length} selected`)).toBeInTheDocument();
  });

  it('renders delete-failure reasons through the deleteFailure catalog keys', async () => {
    translations['exportsList.deleteFailure.notFound'] = 'BEREITS GELÖSCHT';
    translations['exportsList.deleteFailure.unknown'] = 'UNBEKANNT';
    mutateAsyncSpy.mockResolvedValueOnce({ deleted: 0, failed: [
      { id: 'job-ready-1', reason: 'not_found' },
      { id: 'job-ready-2', reason: 'timeout' },
    ] });
    renderPage();
    const checkboxes = within(screen.getByRole('table')).getAllByRole('checkbox', { name: /export,/ });
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('job-ready-1: BEREITS GELÖSCHT')).toBeInTheDocument();
    expect(screen.getByText('job-ready-2: UNBEKANNT')).toBeInTheDocument();
  });

  it('keeps complete mobile job details, ready downloads, selection and selected-loaded export scope', async () => {
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 375, height: 200, x: 0, y: 0, top: 0, right: 375, bottom: 200, left: 0,
      toJSON: () => ({}),
    });
    try {
      renderPage();
      const mobile = screen.getByRole('group', { name: 'Export jobs' });
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(within(mobile).getAllByRole('link', { name: /Download export/ })).toHaveLength(2);
      expect(within(mobile).getByRole('link', { name: 'Download export job-ready-1' }))
        .toHaveAttribute('download');
      fireEvent.click(within(mobile).getAllByRole('button', { name: 'Quick view' })[0]);
      const details = await screen.findByRole('dialog');
      for (const label of ['Type', 'Format', 'Size', 'Created', 'Status', 'Actions']) {
        expect(within(details).getByText(label)).toBeInTheDocument();
      }
      expect(within(details).getByText('drives')).toBeInTheDocument();
      expect(within(details).getByText('csv')).toBeInTheDocument();
      expect(within(details).getByText('2.00 MB')).toBeInTheDocument();
      expect(within(details).getByText('ready')).toBeInTheDocument();
      expect(within(details).getByRole('link', { name: 'Download export job-ready-1' }))
        .toHaveAttribute('href', '/api/v1/export/jobs/job-ready-1/download');
      const footer = details.querySelector('[data-modal-footer]');
      if (!footer) throw new Error('Export job detail modal footer is missing');
      fireEvent.click(within(footer).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      fireEvent.click(within(mobile).getByRole('button', { name: 'Select' }));
      fireEvent.click(within(mobile).getAllByRole('checkbox', { name: /export,/ })[0]);
      expect(screen.getByText('1 selected')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('h-9', 'w-9');
      fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
      expect(screen.getByRole('menuitemradio', { name: 'Selected (1)' })).toHaveAttribute('aria-checked', 'true');
      fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
      await waitFor(() => expect(downloadJSON).toHaveBeenCalledOnce());
      expect(vi.mocked(downloadJSON).mock.calls[0][1]).toEqual([{
        type: 'drives', format: 'csv', file_size: 2 * MB,
        created_at: JOBS[0].created_at, status: 'ready', actions: 'Download',
      }]);
      expect(kpiValue('Total exports')).toBe('6');
      expect(screen.getByText('Status breakdown')).toBeInTheDocument();
      expect(mutateAsyncSpy).not.toHaveBeenCalled();
    } finally {
      bounds.mockRestore();
    }
  });
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
  for (const key of Object.keys(translations)) delete translations[key];
  Object.assign(datePreferences, { locale: 'en-US', timezone_user: 'UTC', tz_display_default: 'user' });
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

describe('ExportsPage — saved date preferences', () => {
  const expectedDate = (value: string) => formatDateTime(value, {
    locale: datePreferences.locale, tz: datePreferences.timezone_user,
  });

  it('updates cells, filter labels, row names and KPI freshness without changing raw UTC exports', async () => {
    const snapshot = structuredClone(JOBS);
    const updatedAt = '2026-04-24T16:30:00Z';
    mockJobs.mockReturnValue(makeQuery({ data: JOBS, dataUpdatedAt: Date.parse(updatedAt) }));
    const view = renderPage();
    for (const preferences of [
      { locale: 'en-US-u-hc-h23', timezone_user: 'America/Los_Angeles' },
      { locale: 'en-US-u-hc-h12', timezone_user: 'Asia/Tokyo' },
    ]) {
      Object.assign(datePreferences, preferences);
      view.rerenderPage();
      const created = expectedDate(JOBS[0].created_at);
      expect(within(screen.getByRole('table')).getByText(created)).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: `Select drives export, ${created}` })).toBeInTheDocument();
      // Face-value disclosure: freshness lives in the Review-details drawer header, not on the face.
      expect(within(kpiRegion()).queryByText(`Last successful load: ${expectedDate(updatedAt)}`)).not.toBeInTheDocument();
      assertOperationalBriefDisclosure(kpiRegion(), `Last successful load: ${expectedDate(updatedAt)}`);
      fireEvent.click(screen.getByRole('button', { name: 'Created filter' }));
      const filter = screen.getByRole('dialog', { name: 'Created filter' });
      expect(within(filter).getByText(created)).toBeInTheDocument();
      fireEvent.click(within(filter).getByRole('button', { name: 'Done' }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
    await waitFor(() => expect(downloadJSON).toHaveBeenCalledOnce());
    // JSON export carries raw values where the row has one (UTC created_at,
    // numeric bytes) and the displayed cell text otherwise — the same "—"
    // the page renders for a missing size, matching the actions column below.
    expect(vi.mocked(downloadJSON).mock.calls[0][1]).toEqual(JOBS.map((row) => ({
      type: row.type, format: row.format, file_size: row.file_size ?? '—',
      created_at: row.created_at, status: row.status,
      actions: row.status === 'ready' ? 'Download' : '—',
    })));
    expect(JOBS).toEqual(snapshot);
  });

  it('updates mobile date summaries, selection names and all-field quick view after preferences change', async () => {
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 375, height: 200, x: 0, y: 0, top: 0, right: 375, bottom: 200, left: 0,
      toJSON: () => ({}),
    });
    try {
      const view = renderPage();
      Object.assign(datePreferences, { locale: 'en-GB-u-hc-h23', timezone_user: 'Asia/Tokyo' });
      view.rerenderPage();
      const created = expectedDate(JOBS[0].created_at);
      const mobile = screen.getByRole('group', { name: 'Export jobs' });
      expect(within(mobile).getByText(created)).toBeInTheDocument();
      fireEvent.click(within(mobile).getByRole('button', { name: 'Select' }));
      expect(within(mobile).getByRole('checkbox', { name: `Select drives export, ${created}` })).toBeInTheDocument();
      fireEvent.click(within(mobile).getAllByRole('button', { name: 'Quick view' })[0]);
      const details = await screen.findByRole('dialog');
      expect(within(details).getByText(created)).toBeInTheDocument();
      for (const label of ['Type', 'Format', 'Size', 'Created', 'Status', 'Actions']) {
        expect(within(details).getByText(label)).toBeInTheDocument();
      }
      // Escape is dispatched on the dialog itself: the shared Modal listens
      // on its container (a window-dispatched keypress never reaches it).
      fireEvent.keyDown(details, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    } finally {
      bounds.mockRestore();
    }
  });
});

describe('ExportsPage — loading', () => {
  it('shows skeletons and never flashes the table or the empty state', () => {
    mockJobs.mockReturnValue(makeQuery({
      isLoading: true, isFetching: true, fetchStatus: 'fetching', data: undefined,
    }));
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

describe('ExportsPage — controlled raw sorting', () => {
  const rows = [
    job({ id: 'sort-a', type: 'alpha', format: 'zip', status: 'ready', file_size: 900,
      created_at: '2026-04-24T10:00:00+02:00' }),
    job({ id: 'sort-b', type: 'beta', format: 'csv', status: 'failed', file_size: 1024,
      created_at: '2026-04-24T07:30:00Z' }),
    job({ id: 'sort-c', type: 'gamma', format: 'json', status: 'queued', file_size: 0,
      created_at: '2026-04-24T09:00:00Z' }),
  ];
  const rowTypes = () => within(screen.getByRole('table'))
    .getAllByRole('checkbox', { name: /export,/ })
    .map((checkbox) => checkbox.getAttribute('aria-label')?.replace(/^(Select|Deselect) /, '').split(' export,')[0]);

  it.each([
    { header: 'Type', descending: ['gamma', 'beta', 'alpha'] },
    { header: 'Format', descending: ['alpha', 'gamma', 'beta'] },
    { header: 'Size', descending: ['beta', 'alpha', 'gamma'] },
    { header: 'Created', descending: ['gamma', 'alpha', 'beta'] },
    { header: 'Status', descending: ['alpha', 'gamma', 'beta'] },
  ])('sorts $header in both directions without changing the source or summary', ({ header, descending }) => {
    const snapshot = structuredClone(rows);
    mockJobs.mockReturnValue(makeQuery({ data: rows }));
    renderPage();
    expect(rowTypes()).toEqual(['alpha', 'beta', 'gamma']);
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: header, exact: true }));
    expect(rowTypes()).toEqual(descending);
    expect(within(screen.getByRole('table')).getByRole('columnheader', { name: new RegExp(header) }))
      .toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: header, exact: true }));
    expect(rowTypes()).toEqual([...descending].reverse());
    expect(within(screen.getByRole('table')).getByRole('columnheader', { name: new RegExp(header) }))
      .toHaveAttribute('aria-sort', 'ascending');
    expect(kpiValue('Total exports')).toBe('3');
    expect(kpiValue('Ready')).toBe('1');
    expect(rows).toEqual(snapshot);
    expect(mutateAsyncSpy).not.toHaveBeenCalled();
  });

  it('keeps missing and invalid numeric/date values distinct from valid zero and preserves tied source order', () => {
    const jobs = [
      job({ id: 'missing', type: 'missing', status: 'ready', created_at: '' }),
      job({ id: 'zero', type: 'zero', status: 'ready', file_size: 0, created_at: '1970-01-01T00:00:00Z' }),
      job({ id: 'invalid', type: 'invalid', status: 'ready', file_size: Number.NaN, created_at: 'invalid' }),
      job({ id: 'positive', type: 'positive', status: 'ready', file_size: 1, created_at: '2026-04-24T00:00:00Z' }),
    ];
    const snapshot = structuredClone(jobs);
    mockJobs.mockReturnValue(makeQuery({ data: jobs }));
    renderPage();
    for (const header of ['Size', 'Created']) {
      fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: header, exact: true }));
      expect(rowTypes()).toEqual(['positive', 'zero', 'missing', 'invalid']);
      fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: header, exact: true }));
      expect(rowTypes()).toEqual(['missing', 'invalid', 'zero', 'positive']);
    }
    expect(jobs).toEqual(snapshot);
  });

  it('retains sorting, selection and downloads through refresh failure and applies the same sort after recovery', () => {
    mockJobs.mockReturnValue(makeQuery({ data: rows }));
    const view = renderPage();
    fireEvent.click(within(screen.getByRole('table')).getByRole('checkbox', { name: /alpha export,/ }));
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Size', exact: true }));
    mockJobs.mockReturnValue(makeQuery({ data: rows, error: new Error('refresh failed'), isError: true }));
    view.rerenderPage();
    expect(rowTypes()).toEqual(['beta', 'alpha', 'gamma']);
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /alpha export,/ })).toBeChecked();
    expect(screen.getByRole('link', { name: 'Download export sort-a' }))
      .toHaveAttribute('href', '/api/v1/export/jobs/sort-a/download');

    mockJobs.mockReturnValue(makeQuery({ data: rows, isFetching: true, fetchStatus: 'fetching' }));
    view.rerenderPage();
    expect(rowTypes()).toEqual(['beta', 'alpha', 'gamma']);
    expect(screen.getByRole('checkbox', { name: /alpha export,/ })).toBeChecked();
    mockJobs.mockReturnValue(makeQuery({ data: rows.map((row) =>
      row.id === 'sort-a' ? { ...row, file_size: 2048 } : row) }));
    view.rerenderPage();
    expect(rowTypes()).toEqual(['alpha', 'beta', 'gamma']);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /alpha export,/ })).toBeChecked();
    expect(kpiValue('Total exports')).toBe('3');
    expect(mutateAsyncSpy).not.toHaveBeenCalled();
  });
});

describe('ExportsPage — populated', () => {
  it('names the jobs table from its existing title without changing its persistence identity', () => {
    renderPage();
    const table = screen.getByRole('table', { name: 'Export jobs' });
    expect(table.querySelector('caption')).toHaveTextContent('Export jobs');
    expect(screen.queryByRole('table', { name: 'exports:jobs' })).not.toBeInTheDocument();
    expect(within(table).getAllByRole('checkbox', { name: /export,/ })).toHaveLength(JOBS.length);

    fireEvent.click(screen.getByRole('button', { name: 'Reorder or hide columns' }));
    const menu = screen.getByRole('menu', { name: 'Reorder or hide columns' });
    fireEvent.click(within(menu).getByRole('checkbox', { name: 'Show or hide Format' }));
    expect(window.localStorage.getItem('teslasync.table.exports:jobs.columns')).not.toBeNull();
    expect(window.localStorage.getItem('teslasync.table.Export jobs.columns')).toBeNull();
    expect(mutateAsyncSpy).not.toHaveBeenCalled();
  });

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
    // "Select drives export, 22 Apr 2026". One per data row → all six rendered.
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
  it.each(['cancel button', 'Escape'] as const)(
    'localizes the existing cancel label and preserves exact selection after %s',
    async (dismissal) => {
      translations['common.cancel'] = 'Abbrechen';
      renderPage();
      const checkboxes = within(screen.getByRole('table')).getAllByRole('checkbox', { name: /export,/ });
      fireEvent.click(checkboxes[0]);
      fireEvent.click(checkboxes[2]);
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog');
      const cancel = within(dialog).getByRole('button', { name: 'Abbrechen' });
      expect(within(dialog).queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
      if (dismissal === 'cancel button') fireEvent.click(cancel);
      else fireEvent.keyDown(window, { key: 'Escape' });

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(mutateAsyncSpy).not.toHaveBeenCalled();
      expect(screen.getByText('2 selected')).toBeInTheDocument();
      checkboxes.forEach((checkbox, index) => {
        expect(checkbox).toHaveProperty('checked', index === 0 || index === 2);
      });
      expect(screen.getByRole('link', { name: 'Download export job-ready-1' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(mutateAsyncSpy).toHaveBeenCalledWith(['job-ready-1', 'job-proc']));
    },
  );

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
    // Face-value disclosure: the status label and freshness live in the
    // Review-details drawer header, not on the face.
    expect(within(kpiRegion()).queryByText('Retained export jobs')).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(kpiRegion(), 'Retained export jobs');
    expect(kpiRegion().querySelector('[data-operational-metric="storage"]')).toHaveAttribute('data-value-state', 'value');
    expect(within(kpiRegion()).queryByText(/Last successful load:/)).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(kpiRegion(), 'Last successful load:', { contains: true });
  });

  it('does not substitute zero totals when the initial source failed', () => {
    mockJobs.mockReturnValue(makeQuery({ data: undefined, error: new Error('offline'), isError: true }));
    renderPage();
    const region = kpiRegion();
    // Face-value disclosure: the missing metric is omitted from the face
    // (rather than rendered with a missing state) and the status label lives
    // in the Review-details drawer header.
    expect(region.querySelector('[data-operational-metric="total"]')).not.toBeInTheDocument();
    assertOperationalMetricUnavailable(kpiRegion(), 'Total exports');
    expect(within(kpiRegion()).queryByText('Export-job source failed')).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(kpiRegion(), 'Export-job source failed');
    expect(screen.getByTestId('ai-advisor-stub')).toBeInTheDocument();
  });

  it('keeps retained raw counts, byte units, downloads and the real drawer when refresh is paused', async () => {
    mockJobs.mockReturnValue(makeQuery({ data: JOBS, fetchStatus: 'paused' }));
    renderPage();
    // Face-value disclosure: the status label lives in the Review-details
    // drawer (asserted below), not on the face.
    expect(within(kpiRegion()).queryByText('Retained jobs · refresh paused')).not.toBeInTheDocument();
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
    assertOperationalMetricUnavailable(kpiRegion(), 'Total exports');
    expect(screen.queryByText('No exports yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Storage used')).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-advisor-stub')).toBeInTheDocument();
    // Face-value disclosure: the status label lives in the Review-details
    // drawer header, not on the face.
    const expectedStatus = fetchStatus === 'paused' ? 'Export-job source paused' : 'Export-job source unresolved';
    expect(within(kpiRegion()).queryByText(expectedStatus)).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(kpiRegion(), expectedStatus);
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
      expect(screen.getByRole('table', { name: 'Export jobs' })).toBeInTheDocument();
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
      assertOperationalMetricUnavailable(kpiRegion(), 'Total exports');

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
      fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Size', exact: true }));
      const checkboxes = within(screen.getByRole('table')).getAllByRole('checkbox', { name: /export,/ });
      expect(checkboxes).toHaveLength(25);
      fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
      await waitFor(() => expect(downloadJSON).toHaveBeenCalledOnce());
      expect(vi.mocked(downloadJSON).mock.calls[0][1]).toEqual([...jobs].reverse().map((row) => ({
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
        { type: 'export-30', format: 'csv', file_size: 30 * 1024, created_at: jobs[30].created_at, status: 'ready', actions: 'Download' },
        { type: 'export-29', format: 'csv', file_size: 29 * 1024, created_at: jobs[29].created_at, status: 'ready', actions: 'Download' },
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
