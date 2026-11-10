import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { APICallLogStats } from '@/types/admin';
import APIUsageWidget from './APIUsageWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';

const mocks = vi.hoisted(() => ({ stats: vi.fn(), refresh: vi.fn() }));
vi.mock('@/api/hooks/useAdmin', () => ({ useApiLogStats: () => mocks.stats() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (match, name: string) => String(values?.[name] ?? match)),
    i18n: { language: 'en', dir: () => 'ltr' },
  }),
}));

const stats: APICallLogStats = {
  totalCalls: 1400,
  last24h: 180,
  avgDurationMs: 82,
  errorRate: 0.5,
  errorCount: 7,
  by_method: { GET: 1200, POST: 200 },
};

function makeQuery(data: Partial<APICallLogStats> | null | undefined = stats) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    error: null as Error | null,
    dataUpdatedAt: Date.now(),
    refetch: mocks.refresh,
  };
}

const clients: QueryClient[] = [];

function mount(packId: unknown, cols = 2) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const element = (pack: unknown) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={pack}>
          <APIUsageWidget size={{ cols, rows: 2 }} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(element(packId));
  return { ...view, selectPack: (pack: unknown) => view.rerender(element(pack)) };
}

async function expectPack(container: HTMLElement, appearance: string) {
  await waitFor(() => {
    expect(container.querySelector('[data-widget-family="bars"]'))
      .toHaveAttribute('data-widget-appearance', appearance);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stats.mockReturnValue(makeQuery());
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 480, height: 160, x: 0, y: 0, top: 0, left: 0, right: 480, bottom: 160,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  vi.restoreAllMocks();
});

describe.each(Object.entries(PACK_APPEARANCES))('API usage %s (%s)', (packId, appearance) => {
  it('uses the real presentation, measured headline, retained-log bars, metrics and refresh action', async () => {
    const { container } = mount(packId);
    await expectPack(container, appearance);

    expect(screen.getByRole('heading', { name: 'API usage' })).toBeInTheDocument();
    expect(screen.getByText('Calls (24h)')).toBeInTheDocument();
    expect(screen.getByText('180')).toBeInTheDocument();
    expect(screen.getByText('Avg response')).toBeInTheDocument();
    expect(screen.getByText('82.00')).toBeInTheDocument();
    expect(screen.getByText('ms')).toBeInTheDocument();
    expect(screen.getByText('Error rate')).toBeInTheDocument();
    expect(screen.getByText('0.50')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
    const chart = screen.getByRole('figure', { name: 'Calls by method · retained logs' });
    expect(chart).toHaveAccessibleDescription(/Method totals cover retained logs, not just the last 24 hours\./);
    const table = within(chart).getByRole('table');
    expect(within(table).getByRole('row', { name: 'GET 1,200' })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: 'POST 200' })).toBeInTheDocument();
    await waitFor(() => expect(chart.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2));
    expect(container.querySelector('[data-widget-family="bars"] svg.lucide')).not.toBeNull();
    expect(chart).not.toHaveTextContent('6h');
    expect(chart).not.toHaveTextContent('12h');

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('retains the compact headline, actual error badge and refresh without mounting a plot', async () => {
    mocks.stats.mockReturnValue(makeQuery({ ...stats, errorRate: 7 }));
    const { container } = mount(packId, 1);
    await expectPack(container, appearance);
    expect(screen.getByText('180')).toBeInTheDocument();
    expect(screen.getByText('7.00% errors')).toBeInTheDocument();
    expect(screen.queryByText('Avg response')).not.toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps unknown metrics and missing method data honest without illustrative buckets', async () => {
    mocks.stats.mockReturnValue(makeQuery({
      last24h: Number.NaN, avgDurationMs: Number.POSITIVE_INFINITY, errorRate: Number.NaN,
    }));
    const { container } = mount(packId);
    await expectPack(container, appearance);
    expect(screen.getByText('Calls (24h)')).toBeInTheDocument();
    expect(screen.getByText('Avg response')).toBeInTheDocument();
    expect(screen.getByText('Error rate')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.getByText('No method breakdown available')).toBeInTheDocument();
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
    expect(screen.queryByText('Infinity')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
    expect(screen.queryByText('ms')).not.toBeInTheDocument();
    expect(screen.queryByText('%')).not.toBeInTheDocument();
  });

  it('retains the metrics and bars during a background failure with a nonblocking warning', async () => {
    mocks.stats.mockReturnValue({
      ...makeQuery(),
      isError: true,
      isStale: true,
      error: new Error('refresh failed'),
    });
    const { container } = mount(packId);
    await expectPack(container, appearance);
    expect(screen.getByText('180')).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: 'Calls by method · retained logs' })).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
  });
});

it('preserves Classic by default, on explicit selection and as the unknown-pack recovery', async () => {
  const { container, selectPack } = mount(undefined);
  expect(container.querySelector('[data-widget-pack="classic"]')).toBeInTheDocument();
  expect(screen.getByText('180')).toBeInTheDocument();
  expect(screen.getByText('82.00')).toBeInTheDocument();
  expect(screen.getByText('0.50')).toBeInTheDocument();
  expect(screen.queryByRole('figure')).not.toBeInTheDocument();
  expect(container.querySelector('[data-widget-family]')).toBeNull();

  selectPack('v1');
  await expectPack(container, 'studio');
  selectPack('v7');
  await expectPack(container, 'pixel');
  selectPack('classic');
  expect(screen.queryByRole('figure')).not.toBeInTheDocument();
  expect(screen.getByText('180')).toBeInTheDocument();
  selectPack('retired-pack');
  expect(container.querySelector('[data-widget-pack="classic"]')).toBeInTheDocument();
  expect(screen.getByText('82.00')).toBeInTheDocument();
  expect(container.querySelector('[data-widget-family]')).toBeNull();
  expect(mocks.refresh).not.toHaveBeenCalled();
});

describe.each(Object.entries(PACK_APPEARANCES))('API usage source states %s (%s)', (packId, appearance) => {
  it('retains empty source shells and independent supporting metric placeholders', async () => {
    mocks.stats.mockReturnValue(makeQuery(null));
    const { container } = mount(packId);
    await expectPack(container, appearance);
    expect(screen.getByRole('heading', { name: 'API usage' })).toBeInTheDocument();
    expect(screen.getByText('No API usage data')).toBeInTheDocument();
    expect(screen.getByText('No method breakdown available')).toBeInTheDocument();
    expect(screen.getByText('Avg response')).toBeInTheDocument();
    expect(screen.getByText('Error rate')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('keeps valid aggregate metrics when the server omits the optional breakdown', async () => {
    mocks.stats.mockReturnValue(makeQuery({ ...stats, by_method: undefined }));
    const { container } = mount(packId);
    await expectPack(container, appearance);
    expect(screen.getByText('180')).toBeInTheDocument();
    expect(screen.getByText('82.00')).toBeInTheDocument();
    expect(screen.getByText('0.50')).toBeInTheDocument();
    expect(screen.getByText('No method breakdown available')).toBeInTheDocument();
    expect(container.querySelector('.recharts-bar')).toBeNull();
    expect(screen.queryByText('6h')).not.toBeInTheDocument();
    expect(screen.queryByText('Top endpoints')).not.toBeInTheDocument();
  });

  it('preserves measured zero counts and leaves invalid grouped readings unknown', async () => {
    mocks.stats.mockReturnValue(makeQuery({
      ...stats, last24h: 0, avgDurationMs: 0, errorRate: 0,
      by_method: { GET: 0, POST: Number.NaN, PATCH: -1 },
    }));
    const { container } = mount(packId);
    await expectPack(container, appearance);
    expect(screen.getAllByText('0')).toHaveLength(2);
    expect(screen.getAllByText('0.00')).toHaveLength(2);
    expect(screen.getByText('ms')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('row', { name: 'GET 0' })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: 'POST —' })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: 'PATCH —' })).toBeInTheDocument();
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
    expect(screen.queryByText('-1')).not.toBeInTheDocument();
  });

  it('uses the existing initial-loading and fatal-error boundaries with a working retry', () => {
    mocks.stats.mockReturnValue({ ...makeQuery(undefined), data: undefined, isLoading: true });
    const { container, selectPack } = mount(packId);
    expect(container.querySelector('[data-data-state="initial"]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('180')).not.toBeInTheDocument();

    mocks.stats.mockReturnValue({
      ...makeQuery(), data: undefined, isError: true, error: new Error('initial failure'),
    });
    selectPack(packId);
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
  });
});
