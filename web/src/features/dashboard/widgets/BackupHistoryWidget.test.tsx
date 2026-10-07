/**
 * BackupHistoryWidget — behaviour + hardening coverage.
 *
 * The widget renders a Tesla Powerwall backup-outage history for the first
 * linked energy site. It exposes a default component plus two pure helpers
 * (`fmtDuration`, `thirtyDaysAgo`). This suite drives every meaningful branch
 * by mocking the two data hooks (`useTeslaEnergySites` / `useTeslaBackupHistory`)
 * so the network is never touched.
 *
 * Facets covered:
 *   - fmtDuration: second/minute/hour spans, the 60s rounding boundary bug
 *     (59.6s must read "1m", not "60s"), and non-finite / negative guards.
 *   - thirtyDaysAgo: ISO-date shape and a ~30-day offset from today.
 *   - no-site guard: renders the "no energy site" empty state, no stats.
 *   - loading: WidgetShell skeleton with content withheld.
 *   - empty events: per-site "no backup events" empty state, no list rows.
 *   - populated standard layout: outage count, average duration, and events
 *     sorted newest-first in a semantic list.
 *   - compact layout: list capped at 3 rows, average-duration stat hidden.
 *   - null-safety: a missing timestamp collapses to "—" and a null duration
 *     to "0s" without crashing.
 *   - refresh: the freshness control refetches sites + events (standard) and
 *     sites only (no-site branch).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { TeslaBackupEvent, TeslaEnergySite } from '@/types/energy';

// ── i18n stub: return the English fallback (2nd arg) or the key ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, def?: string | Record<string, unknown>) =>
      typeof def === 'string' ? def : _key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── Data hooks, driven per test ──
vi.mock('@/api/hooks/useEnergy', () => ({
  useTeslaEnergySites: vi.fn(),
  useTeslaBackupHistory: vi.fn(),
}));

import { useTeslaEnergySites, useTeslaBackupHistory } from '@/api/hooks/useEnergy';
import BackupHistoryWidget, { fmtDuration, thirtyDaysAgo } from './BackupHistoryWidget';

const mockSites = useTeslaEnergySites as unknown as ReturnType<typeof vi.fn>;
const mockEvents = useTeslaBackupHistory as unknown as ReturnType<typeof vi.fn>;

 
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

const SITE = {
  id: 1,
  energy_site_id: 100,
  resource_type: 'battery',
  site_name: 'Home',
  gateway_id: null,
  total_pack_energy: null,
  percentage_charged: null,
  battery_type: null,
  backup_capable: true,
  storm_mode_enabled: false,
  has_solar: false,
  has_battery: true,
  has_grid: true,
  has_load_meter: false,
  tou_capable: false,
  storm_mode_capable: false,
} as unknown as TeslaEnergySite;

function makeEvent(over: Partial<TeslaBackupEvent> = {}): TeslaBackupEvent {
  return {
    id: 1,
    energy_site_id: 100,
    period: 'day',
    timestamp: '2026-06-01T00:00:00Z',
    duration_seconds: 60,
    fetched_at: '2026-06-01T00:00:00Z',
    ...over,
  };
}

 
function setup(opts: { sites?: any; events?: any } = {}) {
  mockSites.mockReturnValue(opts.sites ?? makeQuery({ data: [SITE] }));
  mockEvents.mockReturnValue(opts.events ?? makeQuery({ data: [] }));
}

const STANDARD = { cols: 2, rows: 4 };
const COMPACT = { cols: 1, rows: 2 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fmtDuration', () => {
  it('formats second, minute, and hour spans', () => {
    expect(fmtDuration(0)).toBe('0s');
    expect(fmtDuration(30)).toBe('30s');
    expect(fmtDuration(90)).toBe('1m');
    expect(fmtDuration(3599)).toBe('59m');
    expect(fmtDuration(3600)).toBe('1h');
    expect(fmtDuration(8100)).toBe('2h 15m');
  });

  it('rounds at the 60s boundary instead of rendering "60s"', () => {
    // Regression: rounding used to happen *after* the sub-minute check, so
    // 59.6s rendered the nonsensical "60s". It must roll over to "1m".
    expect(fmtDuration(59.6)).toBe('1m');
    expect(fmtDuration(59.4)).toBe('59s');
  });

  it('guards non-finite and negative input', () => {
    expect(fmtDuration(Number.NaN)).toBe('0s');
    expect(fmtDuration(Number.POSITIVE_INFINITY)).toBe('0s');
    expect(fmtDuration(-42)).toBe('0s');
  });
});

describe('thirtyDaysAgo', () => {
  it('returns an ISO date roughly 30 days before today', () => {
    const s = thirtyDaysAgo();
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const todayUtc = new Date().toISOString().slice(0, 10);
    expect(s < todayUtc).toBe(true);

    const diffDays = Math.round((Date.parse(todayUtc) - Date.parse(s)) / 86_400_000);
    expect(diffDays).toBeGreaterThanOrEqual(29);
    expect(diffDays).toBeLessThanOrEqual(31);
  });
});

describe('BackupHistoryWidget', () => {
  it('renders the "no energy site" empty state when no sites are linked', () => {
    setup({ sites: makeQuery({ data: [] }), events: makeQuery({ data: [] }) });
    render(<BackupHistoryWidget size={STANDARD} />);

    expect(screen.getByText('No Tesla Energy site linked')).toBeInTheDocument();
    expect(screen.queryByText('Outages (30d)')).not.toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton with content withheld while sites load', () => {
    setup({
      sites: makeQuery({ isLoading: true, data: undefined }),
      events: makeQuery({ data: [] }),
    });
    const { container } = render(<BackupHistoryWidget size={STANDARD} />);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Outages (30d)')).not.toBeInTheDocument();
    expect(screen.queryByText('No Tesla Energy site linked')).not.toBeInTheDocument();
  });

  it('renders the "no backup events" empty state for a site with no outages', () => {
    setup({ sites: makeQuery({ data: [SITE] }), events: makeQuery({ data: [] }) });
    render(<BackupHistoryWidget size={STANDARD} />);

    expect(screen.getByText('No backup events in the last 30 days')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.queryByText('Outages (30d)')).not.toBeInTheDocument();
  });

  it('renders outage count, average duration, and events sorted newest-first', () => {
    const events = [
      makeEvent({ id: 1, timestamp: '2026-06-01T00:00:00Z', duration_seconds: 3600 }), // 1h — oldest
      makeEvent({ id: 2, timestamp: '2026-06-03T00:00:00Z', duration_seconds: 90 }), //   1m — newest
      makeEvent({ id: 3, timestamp: '2026-06-02T00:00:00Z', duration_seconds: 45 }), //   45s — middle
    ];
    setup({ sites: makeQuery({ data: [SITE] }), events: makeQuery({ data: events }) });
    render(<BackupHistoryWidget size={STANDARD} />);

    expect(screen.getByText('Outages (30d)')).toBeInTheDocument();
    expect(screen.getByText('Avg Duration')).toBeInTheDocument();
    // count = 3, avg = (3600 + 90 + 45) / 3 = 1245s → "20m"
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('20m')).toBeInTheDocument();

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    // Newest first: Jun 3 (1m badge), Jun 2 (45s), Jun 1 (1h badge).
    expect(within(rows[0]).getByText('1m')).toBeInTheDocument();
    expect(within(rows[1]).getByText('45s')).toBeInTheDocument();
    expect(within(rows[2]).getByText('1h')).toBeInTheDocument();
    // Semantic list for a11y.
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('caps the list at 3 rows and hides average duration in compact layout', () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      makeEvent({
        id: i + 1,
        timestamp: `2026-06-0${i + 1}T00:00:00Z`,
        duration_seconds: (i + 1) * 60,
      }),
    );
    setup({ sites: makeQuery({ data: [SITE] }), events: makeQuery({ data: events }) });
    render(<BackupHistoryWidget size={COMPACT} />);

    expect(screen.getByText('Outages (30d)')).toBeInTheDocument();
    // Full count still reported even though the list is capped.
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.queryByText('Avg Duration')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('handles a missing timestamp and null duration without crashing', () => {
    const events = [
      makeEvent({ id: 1, timestamp: '', duration_seconds: null as unknown as number }),
    ];
    setup({ sites: makeQuery({ data: [SITE] }), events: makeQuery({ data: events }) });
    render(<BackupHistoryWidget size={STANDARD} />);

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('—')).toBeInTheDocument();
    // null duration → 0 → "0s" badge inside the row.
    expect(within(rows[0]).getByText('0s')).toBeInTheDocument();
  });

  it('refetches both sites and events when refreshing the populated widget', () => {
    const refetchSites = vi.fn();
    const refetchEvents = vi.fn();
    setup({
      sites: makeQuery({ data: [SITE], refetch: refetchSites }),
      events: makeQuery({ data: [makeEvent()], refetch: refetchEvents }),
    });
    render(<BackupHistoryWidget size={STANDARD} />);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetchSites).toHaveBeenCalledTimes(1);
    expect(refetchEvents).toHaveBeenCalledTimes(1);
  });

  it('only refetches sites when refreshing the no-site state', () => {
    const refetchSites = vi.fn();
    const refetchEvents = vi.fn();
    setup({
      sites: makeQuery({ data: [], refetch: refetchSites }),
      events: makeQuery({ data: [], refetch: refetchEvents }),
    });
    render(<BackupHistoryWidget size={STANDARD} />);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetchSites).toHaveBeenCalledTimes(1);
    expect(refetchEvents).not.toHaveBeenCalled();
  });
});
