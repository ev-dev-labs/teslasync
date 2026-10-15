import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from '@/api/client';
import { downloadJSON } from '@/lib/csvExport';
import { ApiError } from '@/lib/resilience';
import type { SlowQueryRow } from '@/types/admin-operator-confidence';
import { useSlowQueriesPage } from '../../../hooks/useSlowQueriesPage';
import { SlowQueriesDetails } from './SlowQueriesDetails';
import { SlowQueryAnalysis } from '../../continuation-admin-1/SlowQueryAnalysis';

vi.mock('@/api/client', () => ({ request: vi.fn(), isApiError: () => false }));
vi.mock('@/lib/csvExport', async () => ({
  ...await vi.importActual<typeof import('@/lib/csvExport')>('@/lib/csvExport'),
  downloadJSON: vi.fn(),
}));

const observers: { element: Element; callback: ResizeObserverCallback }[] = [];
const labels = ['Query fingerprint', 'Calls', 'Mean (ms)', 'Max (ms)', 'Total (ms)', 'Rows', 'Cache hit ratio'];
const fingerprint = `SELECT ${'fixture_column_'.repeat(30)} FROM fixture_table WHERE id = $1`;
function row(query_id = 0): SlowQueryRow {
  return {
    query_id, fingerprint: query_id === 0 ? fingerprint : `fixture query ${query_id}`,
    calls: 12, mean_time_ms: 1.25, max_time_ms: 4.5, total_time_ms: 15,
    rows_returned: 120, shared_blks_hit: 75, shared_blks_read: 25,
  };
}

function resize(width: number) {
  act(() => observers.forEach(({ element, callback }) => callback(
    [{ target: element, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver,
  )));
}

function Harness() {
  return <SlowQueriesDetails controller={useSlowQueriesPage()} />;
}

function AnalysisHarness() {
  const controller = useSlowQueriesPage();
  return <>
    <SlowQueryAnalysis chartRows={controller.chartRows} cacheLeaders={controller.cacheLeaders}
      metricLabel={controller.activeMetricLabel} loading={controller.isLoading}
      subsystemMissing={controller.subsystemMissing}
      error={controller.showError ? controller.queryState.fatalError : null}
      onRetry={controller.retry} formatMetric={controller.formatMetric} axisFormat={controller.axisFormat} />
    <SlowQueriesDetails controller={controller} />
  </>;
}

function mountAnalysis() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={client}><AnalysisHarness /></QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...view, client };
}

async function mount(rows: SlowQueryRow[]) {
  vi.mocked(request).mockResolvedValue({ order_by: 'mean_time', slow_queries: rows });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={client}><Harness /></QueryClientProvider>
    </MemoryRouter>,
  );
  await screen.findByText(rows[0].fingerprint);
  return { ...view, client };
}

function details() {
  const dialog = screen.getByRole('dialog');
  return within(dialog).getAllByRole('term').map(term => ({
    label: term.textContent, value: term.nextElementSibling?.textContent,
  }));
}

beforeEach(() => {
  localStorage.clear();
  observers.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { observers.push({ element, callback: this.callback }); }
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-mode');
  document.documentElement.classList.remove('light-mode');
});

describe('SlowQueriesDetails full-detail mobile contract', () => {
  it.each(['light', 'dark'])('keeps every field and full fingerprint reachable by keyboard in %s mode', async mode => {
    document.documentElement.setAttribute('data-mode', mode);
    document.documentElement.classList.toggle('light-mode', mode === 'light');
    const rows = [row()];
    const before = structuredClone(rows);
    const view = await mount(rows);
    resize(375);
    expect(view.container.querySelector('table')).toBeNull();
    const quickView = screen.getByRole('button', { name: 'Quick view' });
    expect(quickView).toHaveClass('min-h-11', 'min-w-11');
    quickView.focus();
    const user = userEvent.setup();
    await user.keyboard('{Enter}');
    expect(details()).toEqual([
      { label: labels[0], value: fingerprint },
      { label: labels[1], value: '12' },
      { label: labels[2], value: '1.25' },
      { label: labels[3], value: '4.50' },
      { label: labels[4], value: '15.00' },
      { label: labels[5], value: '120' },
      { label: labels[6], value: '75.00%' },
    ]);
    expect(within(screen.getByRole('dialog')).getByText(fingerprint)).toHaveClass('[overflow-wrap:anywhere]');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(quickView).toHaveFocus();
    resize(1440);
    expect(view.container.querySelector('[data-mobile-table]')).toBeNull();
    const table = screen.getByRole('table', { name: 'admin:slow-queries' });
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual(labels);
    expect(within(table).getByText(fingerprint)).toBeInTheDocument();
    expect(rows).toEqual(before);
  });

  describe('SlowQueriesDetails unsupported-state propagation', () => {
    it('keeps independent analysis and detail shells with shared unsupported feedback for an initial 503', async () => {
      vi.mocked(request).mockRejectedValue(new ApiError('pg_stat_statements missing', 503));
      const { container } = mountAnalysis();
      await waitFor(() => expect(container.querySelectorAll('[data-data-state="unsupported"]')).toHaveLength(3));
      expect(screen.getByText('Top queries by Mean time')).toBeInTheDocument();
      expect(screen.getByText('Cache efficiency')).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Top queries' })).toBeInTheDocument();
      expect(screen.queryByText('No queries to chart yet.')).toBeNull();
      expect(screen.queryByText('No shared-buffer statistics available for these queries.')).toBeNull();
      expect(screen.queryByText('No slow queries')).toBeNull();
      expect(screen.queryByText("Can't reach server")).toBeNull();
      expect(screen.queryByRole('img', { name: /Horizontal bar chart/ })).toBeNull();
    });

    it('keeps a successful empty response distinct from unsupported configuration', async () => {
      vi.mocked(request).mockResolvedValue({ order_by: 'mean_time', slow_queries: [] });
      const { container } = mountAnalysis();
      expect(await screen.findByText('No slow queries')).toBeInTheDocument();
      expect(screen.getByText('No queries to chart yet.')).toBeInTheDocument();
      expect(screen.getByText('No shared-buffer statistics available for these queries.')).toBeInTheDocument();
      expect(container.querySelector('[data-data-state="unsupported"]')).toBeNull();
    });

    it('preserves populated analysis and complete details when a retained refresh returns 503', async () => {
      vi.mocked(request).mockResolvedValue({ order_by: 'mean_time', slow_queries: [row()] });
      const { client, container } = mountAnalysis();
      const detail = within(screen.getByRole('region', { name: 'Top queries' }));
      await detail.findByText(fingerprint);
      vi.mocked(request).mockRejectedValue(new ApiError('refresh unavailable', 503));
      await act(async () => { await client.invalidateQueries(); });
      await waitFor(() => expect(client.getQueryCache().getAll()[0].state.error).not.toBeNull());
      expect(detail.getByText(fingerprint)).toBeInTheDocument();
      expect(detail.getByText('12')).toBeInTheDocument();
      expect(detail.getByText('120')).toBeInTheDocument();
      expect(screen.getByRole('img', { name: /Horizontal bar chart/ })).toBeInTheDocument();
      expect(screen.getByText('Lowest hit ratios first — I/O-bound queries are the strongest indexing candidates.')).toBeInTheDocument();
      expect(container.querySelector('[data-data-state="unsupported"]')).toBeNull();
      expect(screen.queryByText("Can't reach server")).toBeNull();
    });
  });

  it('retains zero counters and unknown cache stats without inventing a cache ratio', async () => {
    await mount([{ ...row(), calls: 0, mean_time_ms: 0, max_time_ms: 0, total_time_ms: 0,
      rows_returned: 0, shared_blks_hit: null, shared_blks_read: null }]);
    resize(375);
    fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
    expect(details().map(field => field.value)).toEqual([fingerprint, '0', '0.00', '0.00', '0.00', '0', '—']);
  });

  it('preserves paging, loaded filters and complete export rather than exporting the mobile summary', async () => {
    const rows = Array.from({ length: 26 }, (_, id) => row(id));
    const view = await mount(rows);
    resize(375);
    expect(screen.getAllByRole('button', { name: 'Quick view' })).toHaveLength(25);
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
    await waitFor(() => expect(downloadJSON).toHaveBeenCalledTimes(1));
    const exported = vi.mocked(downloadJSON).mock.calls[0][1];
    expect(exported).toHaveLength(26);
    fireEvent.click(screen.getByRole('button', { name: 'Load 1 more' }));
    expect(screen.getAllByRole('button', { name: 'Quick view' })).toHaveLength(26);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search loaded rows' }), { target: { value: 'fixture query 25' } });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Quick view' })).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
    expect(details()[0].value).toBe('fixture query 25');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close', exact: true }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search loaded rows' }), { target: { value: '' } });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Quick view' })).toHaveLength(25));
    resize(1440);
    expect(view.container.querySelector('[data-mobile-table]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
    await waitFor(() => expect(downloadJSON).toHaveBeenCalledTimes(2));
    expect(vi.mocked(downloadJSON).mock.calls[1][1]).toEqual(exported);
    expect(vi.mocked(request).mock.calls[0][0]).toBe('/admin/observability/slow-queries?order_by=mean_time&limit=25');
  });

  it('keeps column-value filters editable on mobile and retains details after a failed refresh', async () => {
    const { client } = await mount([row(), row(1)]);
    resize(375);
    fireEvent.click(screen.getByRole('button', { name: 'Query fingerprint filter' }));
    const filter = screen.getByRole('dialog', { name: 'Query fingerprint filter' });
    fireEvent.click(within(filter).getByRole('checkbox', { name: 'Select all shown values' }));
    expect(screen.queryByRole('button', { name: 'Quick view' })).toBeNull();
    fireEvent.click(within(filter).getByRole('checkbox', { name: 'fixture query 1' }));
    expect(screen.getAllByRole('button', { name: 'Quick view' })).toHaveLength(1);
    fireEvent.keyDown(filter, { key: 'Escape' });
    vi.mocked(request).mockRejectedValue(new Error('fixture refresh failure'));
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(() => expect(client.getQueryCache().getAll()[0].state.error).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
    expect(details().map(field => field.label)).toEqual(labels);
    expect(details()[0].value).toBe('fixture query 1');
  });
});
