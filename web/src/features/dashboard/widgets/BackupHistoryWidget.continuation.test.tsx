import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { queryResult, renderWidget } from '../components/continuation-dashboard-2/testSupport';
import BackupHistoryWidget from './BackupHistoryWidget';

const hooks = vi.hoisted(() => ({ sites: vi.fn(), history: vi.fn() }));
vi.mock('@/api/hooks/useEnergy', () => ({
  useTeslaEnergySites: () => hooks.sites(),
  useTeslaBackupHistory: (...args: unknown[]) => hooks.history(...args),
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

describe('backup history canonical feed preservation', () => {
  it.each([{ cols: 1, rows: 2, limit: 3 }, { cols: 2, rows: 4, limit: 10 }])(
    'keeps source-owned newest ordering, original clock and $limit-event cap',
    ({ cols, rows, limit }) => {
      renderWidget(<BackupHistoryWidget size={{ cols, rows }} />);
      const feed = screen.getByRole('list', { name: 'Event feed' });
      const rowsInFeed = within(feed).getAllByRole('listitem');
      expect(rowsInFeed).toHaveLength(limit);
      expect(within(rowsInFeed[0]).getByText(`clock:${events[11].timestamp}`)).toBeVisible();
      expect(within(rowsInFeed[0]).getByText('0s')).toBeVisible();
      expect(screen.getAllByText(`clock:${events[11].timestamp}`)).toHaveLength(1);
      expect(within(rowsInFeed[limit - 1]).getByText(`clock:${events[12 - limit].timestamp}`)).toBeVisible();
    },
  );

  it('retains the complete event feed and retries both sources after a refresh failure', () => {
    const historyRetry = vi.fn();
    const sitesRetry = vi.fn();
    hooks.sites.mockReturnValue(queryResult([{ energy_site_id: 101 }], { refetch: sitesRetry }));
    hooks.history.mockReturnValue(queryResult(events, { error: new Error('offline'), isError: true, refetch: historyRetry }));
    renderWidget(<BackupHistoryWidget size={{ cols: 2, rows: 4 }} />);
    const feed = screen.getByRole('list', { name: 'Event feed' });
    expect(within(feed).getAllByRole('listitem')).toHaveLength(10);
    fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
    expect(historyRetry).toHaveBeenCalledOnce();
    expect(sitesRetry).toHaveBeenCalledOnce();
  });

  it('keeps a missing duration unknown rather than counting it as a zero-length outage', () => {
    hooks.history.mockReturnValue(queryResult([{ ...events[0], duration_seconds: null }]));
    renderWidget(<BackupHistoryWidget size={{ cols: 2, rows: 4 }} />);
    const feed = screen.getByRole('list', { name: 'Event feed' });
    const row = within(feed).getByRole('listitem');
    expect(within(row).getByText('Duration: —')).toBeVisible();
    expect(within(row).queryByText('0s')).not.toBeInTheDocument();
  });
});
