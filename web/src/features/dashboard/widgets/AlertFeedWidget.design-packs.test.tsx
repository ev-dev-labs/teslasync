import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useAlerts } from '@/api/hooks/useNotifications';
import type { Alert } from '@/api/types';
import AlertFeedWidget from './AlertFeedWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, type PackAppearance, type PackId } from './designPacks/types';
import type { WidgetSize } from './types';

vi.mock('@/api/hooks/useNotifications', () => ({ useAlerts: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, vars?: Record<string, unknown>) =>
      (fallback ?? key).replace(/{{\s*(\w+)\s*}}/g, (token, name: string) =>
        vars?.[name] == null ? token : String(vars[name])),
    i18n: { language: 'en' },
  }),
}));

type AlertsQuery = ReturnType<typeof useAlerts>;
type PresentationPack = Exclude<PackId, 'classic'>;
const packs = Object.entries(PACK_APPEARANCES) as [PresentationPack, PackAppearance][];
const NOW = Date.parse('2026-11-09T20:00:00Z');
const WIDE: WidgetSize = { cols: 3, rows: 2 };
const mockAlerts = vi.mocked(useAlerts);
const refetch = vi.fn<AlertsQuery['refetch']>();

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 1,
    vehicle_id: 7,
    type: 'battery_low',
    severity: 'critical',
    title: 'Battery at 0%',
    message: 'Source message remains outside the compact feed',
    is_read: false,
    created_at: new Date(NOW - 60_000).toISOString(),
    rule_signal: 'BatteryLevel',
    ...overrides,
  };
}

const alerts = [
  alert({ id: 2, severity: 'warning', title: 'Tire pressure warning', created_at: new Date(NOW - 120_000).toISOString() }),
  alert(),
  alert({ id: 3, severity: 'info', title: 'Software update available', vehicle_id: 0, rule_signal: 'CustomSignal', created_at: new Date(NOW - 180_000).toISOString() }),
];

function setQuery(data: Alert[] | undefined, overrides: Partial<AlertsQuery> = {}) {
  mockAlerts.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: data === undefined ? 0 : NOW,
    fetchStatus: 'idle',
    refetch,
    ...overrides,
  } as AlertsQuery);
}

function renderWidget(pack: PresentationPack, size = WIDE) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={pack}>
          <AlertFeedWidget size={size} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function expectTimeline(container: HTMLElement, appearance: PackAppearance) {
  await waitFor(() => {
    expect(container.querySelector(`[data-timeline-appearance="${appearance}"]`)).toBeInTheDocument();
  });
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  refetch.mockClear();
  setQuery(alerts);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each(packs)('Alert feed %s / %s', (pack, appearance) => {
  it('uses the timeline family without dropping ordered titles, severity, times, destinations or refresh', async () => {
    const { container } = renderWidget(pack);
    await expectTimeline(container, appearance);

    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', pack);
    const rows = within(screen.getByRole('list', { name: 'Event feed' })).getAllByRole('listitem');
    expect(rows.map(row => within(row).getByRole('link').textContent)).toEqual([
      'Battery at 0%1m ago', 'Tire pressure warning2m ago', 'Software update available3m ago',
    ]);
    expect(rows[0].querySelector('.lucide-octagon-alert')).toBeInTheDocument();
    expect(rows[1].querySelector('.lucide-triangle-alert')).toBeInTheDocument();
    expect(rows[2].querySelector('.lucide-info')).toBeInTheDocument();
    const battery = new URL(within(rows[0]).getByRole('link').getAttribute('href') ?? '', 'https://teslasync.test');
    expect(battery.pathname).toBe('/battery');
    expect(battery.searchParams.get('vehicle_id')).toBe('7');
    expect(battery.searchParams.get('signal')).toBe('BatteryLevel');
    expect(battery.searchParams.get('t')).toBe(alerts[1].created_at);
    const fallback = within(rows[2]).getByRole('link').getAttribute('href') ?? '';
    expect(fallback).toContain('/signal-explorer?');
    expect(fallback).toContain('signal=CustomSignal');
    expect(fallback).not.toContain('vehicle_id');
    expect(screen.getByText('2 need attention')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All alerts' })).toHaveAttribute('href', '/notifications/inbox');
    expect(screen.queryByText(alerts[0].message)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ cols: 1, rows: 1 }, 5],
    [{ cols: 1, rows: 2 }, 8],
    [WIDE, 12],
  ] as [WidgetSize, number][])('preserves the %j row limit of %i', async (size, count) => {
    setQuery(Array.from({ length: 15 }, (_, index) => alert({
      id: index + 1,
      title: `Alert ${index + 1}`,
      created_at: new Date(NOW - (index + 1) * 60_000).toISOString(),
    })));
    const { container } = renderWidget(pack, size);
    await expectTimeline(container, appearance);
    expect(screen.getAllByRole('listitem')).toHaveLength(count);
    expect(screen.queryByRole('link', { name: 'All alerts' }) !== null).toBe(size.cols >= 3);
  });

  it.each([
    { label: 'empty', data: [] as Alert[], state: 'ok' },
    { label: 'unavailable', data: undefined, state: 'unavailable' },
  ])('keeps the $label feed explicit in its presentation', async ({ data, state }) => {
    setQuery(data);
    const { container } = renderWidget(pack);
    await expectTimeline(container, appearance);
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', state);
    expect(screen.getByText('Alert feed')).toBeInTheDocument();
    expect(screen.getByText('No alerts yet')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText('No unread alerts')).not.toBeInTheDocument();
  });

  it('preserves the initial loading shell rather than inventing empty content', () => {
    setQuery(undefined, { isLoading: true, isFetching: true });
    const { container } = renderWidget(pack);
    expect(container.querySelector('[data-data-state="initial"]')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('[aria-hidden="true"].min-h-24')).toBeInTheDocument();
    expect(screen.queryByText('No alerts yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('preserves fatal-error recovery without presenting a successful empty feed', () => {
    setQuery(undefined, { isError: true, error: new Error('alert source failed') });
    const { container } = renderWidget(pack);
    expect(container.querySelector('[data-data-state="initialFailure"]')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No alerts yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: 'refreshing', overrides: { isFetching: true }, state: 'ok' },
    { label: 'failed refresh', overrides: { isError: true, isStale: true, error: new Error('refresh failed') }, state: 'stale' },
    { label: 'paused refresh', overrides: { fetchStatus: 'paused' as const }, state: 'stale' },
  ])('retains the feed and source trust during $label', async ({ overrides, state }) => {
    setQuery(alerts, overrides);
    const { container } = renderWidget(pack);
    await expectTimeline(container, appearance);
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', state);
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('aria-busy', String(Boolean(overrides.isFetching)));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('2 need attention')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    if (state === 'stale') expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  });

  it.each([
    { severity: 'error', read: false, summary: '1 needs attention', icon: '.lucide-octagon-alert' },
    { severity: 'unrecognised', read: false, summary: '1 unread', icon: '.lucide-info' },
    { severity: 'critical', read: true, summary: 'No unread alerts', icon: '.lucide-octagon-alert' },
  ])('does not confuse unknown severity or zero unread counts with missing data: $summary', async ({ severity, read, summary, icon }) => {
    setQuery([alert({ severity, is_read: read, title: '', created_at: 'invalid' })]);
    const { container } = renderWidget(pack);
    await expectTimeline(container, appearance);
    const row = screen.getByRole('listitem');
    expect(row.querySelector(icon)).toBeInTheDocument();
    expect(within(row).getAllByText('—')).toHaveLength(2);
    expect(screen.getByText(summary)).toBeInTheDocument();
    expect(screen.queryByText(/NaN|Invalid Date/)).not.toBeInTheDocument();
  });
});
