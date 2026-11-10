import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { DataStateSource } from '@/api/dataState';
import { queryResult, renderWidget } from '../components/continuation-dashboard-2/testSupport';
import BackupHistoryWidget from './BackupHistoryWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';

const hooks = vi.hoisted(() => ({
  sites: vi.fn<() => DataStateSource<unknown>>(),
  history: vi.fn<(siteId?: number, since?: string) => DataStateSource<unknown>>(),
}));
vi.mock('@/api/hooks/useEnergy', () => ({
  useTeslaEnergySites: hooks.sites,
  useTeslaBackupHistory: hooks.history,
}));
vi.mock('@/hooks/useDateFormat', async (original) => {
  const actual = await original<typeof import('@/hooks/useDateFormat')>();
  return { ...actual, useDateFormat: () => ({
    ...actual.useDateFormat(),
    formatDateTime: (value: string) => `clock:${value}`,
  }) };
});

const events = Array.from({ length: 12 }, (_, index) => ({
  id: index + 1,
  timestamp: `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
  duration_seconds: index === 11 ? 0 : 8100,
}));

beforeEach(() => {
  vi.clearAllMocks();
  hooks.sites.mockReturnValue(queryResult([{ energy_site_id: 101 }]));
  hooks.history.mockReturnValue(queryResult(events));
});

describe.each(PACK_IDS)('backup history canonical feed preservation in %s', packId => {
  const renderHistory = (size = { cols: 2, rows: 4 }) => renderWidget(
    <PackBoundary requestedPackId={packId}><BackupHistoryWidget size={size} /></PackBoundary>,
  );
  const expectTimeline = async (container: HTMLElement) => {
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
    if (packId === 'classic') {
      expect(container.querySelector('[data-timeline-appearance]')).toBeNull();
    } else {
      await waitFor(() => expect(container.querySelector('[data-timeline-appearance]'))
        .toHaveAttribute('data-timeline-appearance', PACK_APPEARANCES[packId]));
    }
  };

  it.each([{ cols: 1, rows: 2, limit: 3 }, { cols: 2, rows: 4, limit: 10 }])(
    'keeps source-owned newest ordering, original clock and $limit-event cap',
    async ({ cols, rows, limit }) => {
      const { container } = renderHistory({ cols, rows });
      await expectTimeline(container);
      expect(screen.getByRole('heading', { name: 'Backup history' })).toBeVisible();
      expect(screen.getByText('12 · Outages (30d)')).toBeVisible();
      const feed = screen.getByRole('list', { name: 'Event feed' });
      const rowsInFeed = within(feed).getAllByRole('listitem');
      expect(rowsInFeed).toHaveLength(limit);
      expect(within(rowsInFeed[0]).getByText(`clock:${events[11].timestamp}`)).toBeVisible();
      expect(within(rowsInFeed[0]).getByText('0s')).toBeVisible();
      expect(screen.getAllByText(`clock:${events[11].timestamp}`)).toHaveLength(1);
      expect(within(rowsInFeed[limit - 1]).getByText(`clock:${events[12 - limit].timestamp}`)).toBeVisible();
      expect(within(rowsInFeed[1]).getByText('2h 15m')).toBeVisible();
      expect(within(rowsInFeed[1]).getByText('Duration: 2h 15m')).toBeVisible();
    },
  );

  it.each(['sites', 'history'] as const)('retains the complete event feed and retries both sources after a %s refresh failure', async source => {
    const historyRetry = vi.fn();
    const sitesRetry = vi.fn();
    const failed = { error: new Error('offline'), isError: true };
    hooks.sites.mockReturnValue(queryResult([{ energy_site_id: 101 }], { refetch: sitesRetry, ...(source === 'sites' ? failed : {}) }));
    hooks.history.mockReturnValue(queryResult(events, { refetch: historyRetry, ...(source === 'history' ? failed : {}) }));
    const { container } = renderHistory();
    await expectTimeline(container);
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', source === 'history' ? 'stale' : 'partial');
    const feed = screen.getByRole('list', { name: 'Event feed' });
    expect(within(feed).getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    // The shell hides the warning retry when the freshness control exists; recovery is the freshness dot.
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    expect(historyRetry).toHaveBeenCalledOnce();
    expect(sitesRetry).toHaveBeenCalledOnce();
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, -1])('keeps duration %s unknown rather than counting it as a zero-length outage', async duration => {
    hooks.history.mockReturnValue(queryResult([{ ...events[0], duration_seconds: duration, timestamp: '' }]));
    const { container } = renderHistory();
    await expectTimeline(container);
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'partial');
    const feed = screen.getByRole('list', { name: 'Event feed' });
    const row = within(feed).getByRole('listitem');
    expect(within(row).getByText('Duration: —')).toBeVisible();
    expect(within(row).getAllByText('—')).toHaveLength(2);
    expect(within(row).queryByText('0s')).not.toBeInTheDocument();
  });

  it.each(['sites', 'history'] as const)('withholds events while %s initially loads', source => {
    hooks[source].mockReturnValue(queryResult(undefined, { isLoading: true, isPending: true, isFetching: true }));
    const { container } = renderHistory();
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'initial');
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('list', { name: 'Event feed' })).not.toBeInTheDocument();
    expect(screen.queryByText('No Tesla energy site linked')).not.toBeInTheDocument();
    expect(screen.queryByText('No backup events in the last 30 days')).not.toBeInTheDocument();
  });

  it.each(['sites', 'history'] as const)('retries the contributing sources after an initial %s failure without claiming zero outages', source => {
    const sitesRetry = vi.fn();
    const historyRetry = vi.fn();
    const failure = { error: new Error('offline'), isError: true, dataUpdatedAt: 0 };
    hooks.sites.mockReturnValue(queryResult(source === 'sites' ? undefined : [{ energy_site_id: 101 }], {
      refetch: sitesRetry, ...(source === 'sites' ? failure : {}),
    }));
    hooks.history.mockReturnValue(queryResult(undefined, {
      refetch: historyRetry, ...(source === 'history' ? failure : {}),
    }));
    const { container } = renderHistory();
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'initialFailure');
    expect(screen.queryByRole('list', { name: 'Event feed' })).not.toBeInTheDocument();
    expect(screen.queryByText('No backup events in the last 30 days')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(sitesRetry).toHaveBeenCalledOnce();
    expect(historyRetry).toHaveBeenCalledTimes(source === 'history' ? 1 : 0);
  });

  it.each([{ sites: [] }, { sites: [{ energy_site_id: 0 }] }])('keeps discovery-only recovery for absent or invalid sites $sites', ({ sites }) => {
    const sitesRetry = vi.fn();
    const historyRetry = vi.fn();
    hooks.sites.mockReturnValue(queryResult(sites, { refetch: sitesRetry }));
    hooks.history.mockReturnValue(queryResult(undefined, { refetch: historyRetry }));
    renderHistory();
    expect(screen.getByRole('heading', { name: 'Backup history' })).toBeVisible();
    expect(screen.getByText('No Tesla energy site linked')).toBeVisible();
    expect(hooks.history).toHaveBeenLastCalledWith(undefined, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(screen.queryByRole('list', { name: 'Event feed' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    expect(sitesRetry).toHaveBeenCalledOnce();
    expect(historyRetry).not.toHaveBeenCalled();
  });

  it.each([
    { data: [], message: 'No backup events in the last 30 days', state: 'ok' },
    { data: null, message: 'This widget has no qualifying data yet.', state: 'partial' },
  ])('distinguishes returned history $data from unknown history', ({ data, message, state }) => {
    hooks.history.mockReturnValue(queryResult(data));
    const { container } = renderHistory();
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', state);
    expect(screen.getByText(message)).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Event feed' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Outages \(30d\)/)).not.toBeInTheDocument();
  });
});

it('preserves the source window and focused refresh command while switching through every pack', async () => {
  const tree = (pack: PackId) => <PackBoundary requestedPackId={pack}>
    <BackupHistoryWidget size={{ cols: 2, rows: 4 }} />
  </PackBoundary>;
  const view = renderWidget(tree('classic'));
  const originalArguments = hooks.history.mock.calls[0];
  const refresh = screen.getByRole('button', { name: /^Refresh data/i });
  refresh.focus();
  for (const pack of PACK_IDS) {
    view.rerender(tree(pack));
    if (pack !== 'classic') {
      await waitFor(() => expect(view.container.querySelector('[data-timeline-appearance]'))
        .toHaveAttribute('data-timeline-appearance', PACK_APPEARANCES[pack]));
    }
    expect(hooks.history).toHaveBeenLastCalledWith(...originalArguments);
    expect(screen.getByRole('button', { name: /^Refresh data/i })).toBe(refresh);
    expect(refresh).toHaveFocus();
    expect(within(screen.getByRole('list', { name: 'Event feed' })).getAllByRole('listitem')).toHaveLength(10);
  }
});
