/**
 * MediaPlayerPage — behaviour + hardening coverage.
 *
 * MediaPlayerPage exposes a single default export (the "now playing / volume /
 * listening history" page). This suite drives it through every meaningful
 * branch by mocking only its data + environment hooks (`useMedia` /
 * `useMediaHistory` / `useSelectedVehicle` / `useRangeState`), the side-effect
 * `usePageTitle`, the motion primitives, the charts barrel, and the forms row.
 * Everything on the render boundary — PageContainer, GlassPanel, MetricCard,
 * DataTable, Badge, EmptyState, AlertBanner, Skeleton, QueryError — is REAL, so
 * the page's own null-safety, empty/error/loading routing, aggregation, and
 * sorting are actually exercised. Network is never touched.
 *
 * The charts barrel is stubbed to inert primitives, but the two constants the
 * page indexes into (`CHART_COLORS`) and spreads (`chartGrid`/`axisTickSm`) are
 * real-shaped, and two stubs deliberately surface props the page computes:
 *   - `YAxis` echoes its `domain` so the volume-axis ceiling maths is assertable.
 *   - `LinearGauge` echoes `value`/`max` so the volume gauge wiring is assertable.
 *
 * Facets covered:
 *   - no-vehicle guard: every section shows its "select a vehicle" copy, KPIs
 *     degrade to honest placeholders, and both hooks are scoped to the empty id.
 *   - loading: skeletons render; no error/empty copy leaks; KPIs withheld.
 *   - error + retry: the page-level AlertBanner surfaces the message and every
 *     data section renders a retryable QueryError wired to the right refetch.
 *   - populated happy path: now-playing hero (title/artist/album/station/source/
 *     status/progress), volume gauge, honest KPI tiles, source legend, the
 *     history table, and the stringified hook wiring.
 *   - avgVolume bug fix: snapshots missing a volume reading are excluded from the
 *     mean instead of being counted as 0.
 *   - volume-chart bug fix: the same volumeless snapshots are dropped from the
 *     charted series (no phantom drops to silence); an all-missing history
 *     renders the no-volume empty state instead of a flat zero chart.
 *   - fmtPlayTime + progressbar aria bug fix: a negative elapsed clamps to 0:00
 *     and aria-valuenow 0 instead of rendering "-1:-05" / a negative value.
 *   - volume-axis clip bug fix: when the latest snapshot is missing, the Y-axis
 *     ceiling comes from the charted peak instead of the small fallback.
 *   - source-icon / status branches: FM radio, podcast, and aux sources render
 *     alongside the unrecognized source status without inventing "Stopped".
 *   - interactions: the shared range is read without a local trigger; sorting
 *     the Track column reorders the table and toggles direction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps, ReactNode } from 'react';

import type { MediaSnapshot } from '@/api/types';
import { setGlobalPrecision } from '@/lib/numberFormat';
import * as dateFormatting from '@/hooks/useDateFormat';
import { formatDateTime } from '@/lib/dateFormat';

// ── i18n stub: resolve the string fallback (or an options-bag defaultValue) and
//    interpolate {{var}} placeholders so assertions read on human copy. ────────
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
      return interpolate(second, third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined);
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

// ── motion primitives: render children verbatim (strip animation). ──
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

// ── charts barrel: recharts primitives are inert, but the containers pass their
//    children through so YAxis (echoing `domain`) still mounts, and the two
//    data constants the page relies on are real-shaped. ───────────────────────
vi.mock('@/components/charts', async () => {
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  const { LinearGauge } = await import('@/components/charts/LinearGauge');
  const { EmbeddedChart } = await import('@/components/charts/EmbeddedChart');
  const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const Null = () => null;
  return {
    ...chartTestDoubles,
    EmbeddedChart,
    CHART_COLORS: ['#06b6d4', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'],
    chartGrid: {},
    axisTickSm: {},
    ChartTooltip: Null,
    ChartGradient: Null,
    ResponsiveContainer: Passthrough,
    // Real <svg> so the page's <defs> gradient node is valid markup (no
    // "unrecognized tag" warning) while children still mount.
    AreaChart: ({ children, data }: { children?: ReactNode; data?: { time: string; volume: number }[] }) => (
      <svg data-testid="volume-chart" data-points={String(Array.isArray(data) ? data.length : -1)}
        data-values={JSON.stringify(data?.map(point => point.volume))}
        data-times={JSON.stringify(data?.map(point => point.time))}>
        {children}
      </svg>
    ),
    Area: Null,
    XAxis: Null,
    CartesianGrid: Null,
    Tooltip: Null,
    PieChart: Passthrough,
    Pie: Passthrough,
    Cell: Null,
    YAxis: ({ domain }: { domain?: unknown }) => (
      <g data-testid="volume-yaxis" data-domain={JSON.stringify(domain ?? null)} />
    ),
    LinearGauge: (props: ComponentProps<typeof LinearGauge>) => (
      <div data-testid="linear-gauge" data-value={String(props.value)} data-max={String(props.max)}>
        <LinearGauge {...props} />
      </div>
    ),
  };
});

// ── Keep the legacy form doubles inert; the page must not mount either
//    workspace control now that the application header owns both. ──
vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
  RangePicker: ({
    value,
    onChange,
    triggerTestId,
  }: {
    value: { start: string; end: string };
    onChange: (v: { start: string; end: string }) => void;
    triggerTestId?: string;
  }) => (
    <button
      type="button"
      data-testid={triggerTestId ?? 'range-picker'}
      onClick={() => onChange({ start: '2026-06-05', end: '2026-06-20' })}
    >
      {`${value.start}|${value.end}`}
    </button>
  ),
}));

// ── side-effect-only hook + data/environment hooks, driven per test. ──
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/hooks/useRangeState', () => ({ useRangeState: vi.fn() }));
vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  request: vi.fn(() => Promise.reject(new Error('Unexpected request in media presentation test'))),
}));
vi.mock('@/api/hooks/useVehicleSystems', () => ({
  useMedia: vi.fn(),
  useMediaHistory: vi.fn(),
}));

import { useMedia, useMediaHistory } from '@/api/hooks/useVehicleSystems';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useRangeState } from '@/hooks/useRangeState';
import MediaPlayerPage from './MediaPlayerPage';

const mockMedia = useMedia as unknown as ReturnType<typeof vi.fn>;
const mockHistory = useMediaHistory as unknown as ReturnType<typeof vi.fn>;
const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockRange = useRangeState as unknown as ReturnType<typeof vi.fn>;

const RANGE = {
  start: '2026-06-01', end: '2026-06-30',
  startInstant: '2026-06-01T00:00:00.000Z',
  endInstantExclusive: '2026-07-01T00:00:00.000Z',
};

 
function makeQuery(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    isPending: false,
    status: 'success',
    fetchStatus: 'idle',
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function snapshot(over: Partial<MediaSnapshot> = {}): MediaSnapshot {
  return {
    id: 1,
    vehicle_id: 7,
    now_playing_title: 'Track',
    now_playing_artist: 'Artist',
    playback_source: 'Spotify',
    playback_status: 'Playing',
    audio_volume: 5,
    audio_volume_max: 10,
    created_at: '2026-06-10T10:00:00Z',
    ...over,
  };
}

// The now-playing hero snapshot: playing, with album + station + a 3:05 track at
// 1:05 elapsed and a 0.5 volume step so every hero sub-field is observable.
const LATEST: MediaSnapshot = snapshot({
  id: 99,
  now_playing_title: 'Now Song',
  now_playing_artist: 'Now Artist',
  now_playing_album: 'Now Album',
  now_playing_station: 'KEXP',
  now_playing_duration: 185000,
  now_playing_elapsed: 65000,
  playback_status: 'Playing',
  playback_source: 'Spotify',
  audio_volume: 5,
  audio_volume_max: 10,
  audio_volume_increment: 0.5,
  created_at: '2026-06-12T12:30:00Z',
});

// Three in-range history rows. Titles (Zeta/Alpha/Mid) are deliberately NOT in
// created_at order so a Track-column sort visibly reorders the table. Sources
// are Spotify×2 + Bluetooth×1 (top source = Spotify) and volumes 4/8/6 average
// to a clean 6.
const HISTORY: MediaSnapshot[] = [
  snapshot({ id: 1, now_playing_title: 'Zeta Track', now_playing_artist: 'Artist Z', playback_source: 'Spotify', playback_status: 'Playing', audio_volume: 4, created_at: '2026-06-10T10:00:00Z' }),
  snapshot({ id: 2, now_playing_title: 'Alpha Track', now_playing_artist: 'Artist A', playback_source: 'Spotify', playback_status: 'Paused', audio_volume: 8, created_at: '2026-06-11T11:00:00Z' }),
  snapshot({ id: 3, now_playing_title: 'Mid Track', now_playing_artist: 'Artist M', playback_source: 'Bluetooth', playback_status: 'Stopped', audio_volume: 6, created_at: '2026-06-12T12:00:00Z' }),
];

 
function selected(vehicleId: number | null): any {
  return {
    vehicleId,
    vehicle: null,
    vehicles: vehicleId != null ? [{ id: vehicleId, display_name: 'Model 3', vin: 'VIN7' }] : [],
    setVehicleId: vi.fn(),
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/media']}>
      <QueryClientProvider client={client}>
        <MediaPlayerPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const statsRegion = () => screen.getByRole('region', { name: 'Listening stats' });
const nowPlayingRegion = () => screen.getByRole('region', { name: 'Now playing' });

/** Read the shared stat tile's value, excluding its help and source context. */
function kpiValue(label: string): string {
  const span = within(statsRegion()).getByText(label, { selector: '[data-operational-metric] > div:first-child > :first-child' });
  const value = span.closest('[data-operational-metric]')?.querySelector('[data-operational-value]');
  if (!(value instanceof HTMLElement)) throw new Error(`Missing ${label} stat value`);
  return value.textContent ?? '';
}

/** Non-spacer <tbody> rows of the playback-history table. */
function bodyRows(): HTMLElement[] {
  const table = screen.getByRole('table', { name: 'Playback history' });
  return Array.from(table.querySelectorAll('tbody tr')).filter(
    (r) => !r.hasAttribute('aria-hidden'),
  ) as HTMLElement[];
}

beforeEach(() => {
  mockMedia.mockReset();
  mockHistory.mockReset();
  mockSelected.mockReset();
  mockRange.mockReset();
  setGlobalPrecision(2);

  mockRange.mockReturnValue({ ...RANGE, setRange: vi.fn() });
  mockSelected.mockReturnValue(selected(7));
  mockMedia.mockReturnValue(makeQuery({ data: LATEST }));
  mockHistory.mockReturnValue(makeQuery({ data: HISTORY }));
});

describe('MediaPlayerPage — no vehicle selected', () => {
  it('prompts for a vehicle in every section, degrades KPIs, and scopes both hooks to the empty id', () => {
    mockSelected.mockReturnValue(selected(null));
    mockMedia.mockReturnValue(makeQuery({ data: undefined }));
    mockHistory.mockReturnValue(makeQuery({ data: [] }));
    renderPage();

    const prompts = within(nowPlayingRegion()).getAllByText(/Select a vehicle to see what.s playing/);
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) expect(prompt).toBeInTheDocument();
    expect(screen.getByText('Select a vehicle to view volume history')).toBeInTheDocument();
    expect(screen.getByText('Select a vehicle to view sources')).toBeInTheDocument();
    expect(screen.getByText('Select a vehicle to view playback history')).toBeInTheDocument();

    // KPIs collapse to honest placeholders, not stale numbers.
    expect(kpiValue('Unique tracks')).toBe('—');
    expect(kpiValue('Top source')).toBe('—');
    expect(kpiValue('Avg volume')).toBe('—');

    // Both queries are scoped to the empty vehicle (disabled upstream).
    expect(mockMedia).toHaveBeenCalledWith('');
    expect(mockHistory).toHaveBeenCalledWith('', { start: RANGE.start, end: RANGE.end });

    // No table renders without a vehicle, so no header sort controls exist.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('MediaPlayerPage — loading', () => {
  it('shows skeletons and never flashes error, retry, or empty copy', () => {
    mockMedia.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    mockHistory.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    const { container } = renderPage();

    expect(container.querySelector('[class*="--skeleton-bg"]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByText('No volume data for this period')).not.toBeInTheDocument();
    expect(screen.queryByText('No playback history for this period')).not.toBeInTheDocument();
    expect(statsRegion()).toHaveAttribute('aria-busy', 'true');
    expect(within(statsRegion()).getByText('Loading source')).toBeInTheDocument();
    expect(statsRegion().querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(statsRegion().querySelector('[data-operational-value]')).not.toBeInTheDocument();
  });
});

describe('MediaPlayerPage — missing live snapshot', () => {
  it('refreshes only the live media source from both empty live panels without inventing a reading', () => {
    const refetch = vi.fn();
    const historyRefetch = vi.fn();
    mockMedia.mockReturnValue(makeQuery({ data: null, refetch }));
    mockHistory.mockReturnValue(makeQuery({ data: HISTORY, refetch: historyRefetch }));
    renderPage();
    const empties = screen.getAllByText('No media snapshot available');
    expect(empties).toHaveLength(2);
    for (const message of empties) {
      const status = message.closest('[role="status"]');
      if (!(status instanceof HTMLElement)) throw new Error('Missing media empty state');
      fireEvent.click(within(status).getByRole('button', { name: 'Refresh' }));
    }
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(historyRefetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId('linear-gauge')).not.toBeInTheDocument();
    expect(screen.getByTestId('volume-chart')).toBeInTheDocument();
  });
});

describe('MediaPlayerPage — retrieval versus measurement time', () => {
  const measurementNotice = 'Measurement time unavailable; the latest media response does not include observation timestamps.';

  it.each([
    {},
    { error: new Error('Refresh failed'), isError: true },
    { fetchStatus: 'paused' },
  ])('discloses retrieval time without claiming measurement freshness for retained media (%j)', queryState => {
    const retrievedAt = Date.parse('2026-06-15T15:45:00Z');
    mockMedia.mockReturnValue(makeQuery({
      data: LATEST, dataUpdatedAt: retrievedAt, ...queryState,
    }));
    const view = renderPage();

    const notice = within(nowPlayingRegion()).getByText(/Media retrieved at:/);
    const initialNotice = notice.textContent;
    expect(notice).toHaveTextContent(measurementNotice);
    expect(notice).not.toHaveTextContent('—');
    expect(within(nowPlayingRegion()).getByText('Now Song')).toBeInTheDocument();
    expect(screen.getByTestId('linear-gauge')).toHaveAttribute('data-value', '5');
    expect(bodyRows()).toHaveLength(HISTORY.length);

    mockMedia.mockReturnValue(makeQuery({
      data: LATEST, dataUpdatedAt: retrievedAt + 86_400_000, ...queryState,
    }));
    view.rerender(
      <MemoryRouter initialEntries={['/media']}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MediaPlayerPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const refreshedNotice = within(nowPlayingRegion()).getByText(/Media retrieved at:/);
    expect(refreshedNotice.textContent).not.toBe(initialNotice);
    expect(refreshedNotice).toHaveTextContent(measurementNotice);
  });

  it.each([0, undefined])('keeps unknown retrieval time unknown (%s), even with populated history', dataUpdatedAt => {
    mockMedia.mockReturnValue(makeQuery({
      data: { ...LATEST, created_at: undefined, ts: undefined }, dataUpdatedAt,
    }));
    renderPage();
    const notice = within(nowPlayingRegion()).getByText(/Media retrieved at:/);
    expect(notice).toHaveTextContent('Media retrieved at: —');
    expect(notice).toHaveTextContent(measurementNotice);
    expect(within(nowPlayingRegion()).getByText('Now Song')).toBeInTheDocument();
  });

  it.each([null, undefined])('does not disclose a retrieval time for an absent latest payload (%s)', data => {
    mockMedia.mockReturnValue(makeQuery({ data }));
    renderPage();
    expect(within(nowPlayingRegion()).queryByText(/Media retrieved at:/)).not.toBeInTheDocument();
  });
});

describe('MediaPlayerPage — date formatting preferences', () => {
  it('updates absolute chart labels and mobile history strings when the bound formatter changes', () => {
    const useActualDateFormat = dateFormatting.useDateFormat;
    const spy = vi.spyOn(dateFormatting, 'useDateFormat');
    const utcOptions = { locale: 'en-US', tz: 'UTC' };
    const localOptions = { locale: 'de-DE', tz: 'America/Los_Angeles' };
    const utcFormatter: dateFormatting.DateFormatter = value => formatDateTime(value, utcOptions);
    const localFormatter: dateFormatting.DateFormatter = value => formatDateTime(value, localOptions);
    spy.mockImplementation(() => ({ ...useActualDateFormat(), formatDateTime: utcFormatter }));

    try {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const ui = () => (
        <MemoryRouter initialEntries={['/media']}>
          <QueryClientProvider client={client}>
            <MediaPlayerPage />
          </QueryClientProvider>
        </MemoryRouter>
      );
      const view = render(ui());
      const mobileHistory = view.container.querySelector('[data-mobile-table]');
      if (!(mobileHistory instanceof HTMLElement)) throw new Error('Missing mobile history');

      expect(screen.getByTestId('volume-chart')).toHaveAttribute(
        'data-times', JSON.stringify(HISTORY.map(row => utcFormatter(row.created_at))),
      );
      expect(mobileHistory).toHaveTextContent(utcFormatter(HISTORY[0].created_at));

      spy.mockImplementation(() => ({ ...useActualDateFormat(), formatDateTime: localFormatter }));
      view.rerender(ui());

      const expectedLabels = HISTORY.map(row => localFormatter(row.created_at));
      expect(expectedLabels).not.toEqual(HISTORY.map(row => utcFormatter(row.created_at)));
      expect(screen.getByTestId('volume-chart')).toHaveAttribute('data-times', JSON.stringify(expectedLabels));
      expect(mobileHistory).toHaveTextContent(expectedLabels[0]);
      expect(mobileHistory).not.toHaveTextContent(utcFormatter(HISTORY[0].created_at));
      expect(screen.getByTestId('volume-chart')).toHaveAttribute('data-values', '[4,8,6]');
      expect(bodyRows()).toHaveLength(HISTORY.length);
      expect(within(nowPlayingRegion()).getByText('Now Song')).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('MediaPlayerPage — paused initial sources', () => {
  it.each([false, true])('shows pause instead of empty or loading (isLoading=%s), retries each source, and recovers', isLoading => {
    const liveRetry = vi.fn();
    const historyRetry = vi.fn();
    mockMedia.mockReturnValue(makeQuery({
      data: undefined, fetchStatus: 'paused', isPending: true, isLoading, refetch: liveRetry,
    }));
    mockHistory.mockReturnValue(makeQuery({
      data: undefined, fetchStatus: 'paused', isPending: true, isLoading, refetch: historyRetry,
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = () => <MemoryRouter initialEntries={['/media-player']}>
      <QueryClientProvider client={client}><MediaPlayerPage /></QueryClientProvider>
    </MemoryRouter>;
    const view = render(ui());

    expect(screen.getAllByText('Paused offline')).toHaveLength(5);
    expect(view.container.querySelector('[class*="--skeleton-bg"]')).toBeNull();
    for (const message of [
      'No media snapshot available', 'No volume data for this period',
      'No source data available', 'No playback history for this period',
    ]) {
      expect(screen.queryByText(message)).not.toBeInTheDocument();
    }
    expect(kpiValue('Unique tracks')).toBe('—');
    expect(kpiValue('Avg volume')).toBe('—');
    expect(statsRegion()).not.toHaveAttribute('aria-busy');
    expect(within(statsRegion()).getByText('Evidence unresolved')).toBeInTheDocument();
    expect(within(statsRegion()).queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByTestId('linear-gauge')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    for (const button of within(nowPlayingRegion()).getAllByRole('button', { name: 'Retry' })) {
      fireEvent.click(button);
    }
    expect(liveRetry).toHaveBeenCalledTimes(2);
    expect(historyRetry).not.toHaveBeenCalled();
    const historyButtons = screen.getAllByRole('button', { name: 'Retry' })
      .filter(button => !nowPlayingRegion().contains(button));
    expect(historyButtons).toHaveLength(3);
    for (const button of historyButtons) fireEvent.click(button);
    expect(historyRetry).toHaveBeenCalledTimes(3);
    expect(liveRetry).toHaveBeenCalledTimes(2);

    mockMedia.mockReturnValue(makeQuery({ data: LATEST, refetch: liveRetry }));
    view.rerender(ui());
    expect(within(nowPlayingRegion()).getByText('Now Song')).toBeInTheDocument();
    expect(screen.getAllByText('Paused offline')).toHaveLength(3);
    expect(screen.queryByText('No playback history for this period')).not.toBeInTheDocument();

    mockHistory.mockReturnValue(makeQuery({ data: [], refetch: historyRetry }));
    view.rerender(ui());
    expect(screen.queryByText('Paused offline')).not.toBeInTheDocument();
    expect(screen.getByText('No volume data for this period')).toBeInTheDocument();
    expect(screen.getByText('No source data available')).toBeInTheDocument();
    expect(screen.getByText('No playback history for this period')).toBeInTheDocument();
    expect(kpiValue('Unique tracks')).toBe('0');
    expect(statsRegion()).not.toHaveAttribute('aria-busy');
    expect(within(statsRegion()).getByText('Returned evidence')).toBeInTheDocument();
    expect(within(nowPlayingRegion()).getByText('Now Song')).toBeInTheDocument();
  });
});

describe('MediaPlayerPage — unreported title and authoritative playback status', () => {
  it.each([undefined, null, '', '   ', 0, false])(
    'keeps an unreported or invalid title (%s) unknown without inferring no playback',
    title => {
      mockMedia.mockReturnValue(makeQuery({
        data: { ...LATEST, now_playing_title: title, playback_status: null },
      }));
      renderPage();

      expect(within(nowPlayingRegion()).getByText('No reading reported')).toBeInTheDocument();
      expect(within(nowPlayingRegion()).getByText('Unknown status')).toBeInTheDocument();
      expect(screen.queryByText('No track')).not.toBeInTheDocument();
      expect(within(nowPlayingRegion()).queryByText('Stopped')).not.toBeInTheDocument();
      for (const name of ['Now playing', 'Volume', 'Volume over time', 'Source distribution', 'Playback history']) {
        expect(screen.getByRole('heading', { name, level: 3 })).toBeInTheDocument();
      }
      expect(statsRegion()).toBeInTheDocument();
      expect(bodyRows()).toHaveLength(3);
    },
  );

  it.each([
    ['Stopped', 'Stopped'],
    [' stopped ', 'Stopped'],
    ['Playing', 'Playing'],
    ['Paused', 'Paused'],
    ['not playing', 'not playing'],
    ['not stopped', 'not stopped'],
    ['   ', 'Unknown status'],
    [false, 'Unknown status'],
  ])('uses only a reported exact playback state (%s)', (status, label) => {
    mockMedia.mockReturnValue(makeQuery({
      data: { ...LATEST, now_playing_title: null, playback_status: status },
    }));
    renderPage();

    expect(within(nowPlayingRegion()).getByText('No reading reported')).toBeInTheDocument();
    expect(within(nowPlayingRegion()).getByText(label)).toBeInTheDocument();
    if (label !== 'Stopped') expect(within(nowPlayingRegion()).queryByText('Stopped')).not.toBeInTheDocument();
    if (label !== 'Playing') expect(within(nowPlayingRegion()).queryByText('Playing')).not.toBeInTheDocument();
  });
});

describe('MediaPlayerPage — missing, invalid and measured audio readings', () => {
  it.each([undefined, null, NaN, Infinity, -Infinity, '', '0', false])(
    'does not turn a missing or invalid reading (%s) into measured zero',
    reading => {
      const data = { ...LATEST, audio_volume: reading, audio_volume_max: reading, audio_volume_increment: reading };
      mockMedia.mockReturnValue(makeQuery({ data }));
      mockHistory.mockReturnValue(makeQuery({ data: [data] }));
      renderPage();

      expect(screen.getByTestId('linear-gauge')).toHaveAttribute('data-value', 'null');
      expect(kpiValue('Volume step')).toBe('—');
      expect(kpiValue('Avg volume')).toBe('—');
      expect(screen.getByText('—/—')).toBeInTheDocument();
      expect(screen.getByText('No volume data for this period')).toBeInTheDocument();
      expect(screen.queryByTestId('volume-chart')).not.toBeInTheDocument();
      expect(screen.queryByRole('table', { name: 'Volume over time — data table' })).not.toBeInTheDocument();
    },
  );

  it.each([0, -2.5, 0.25])('preserves the measured audio scalar %s', reading => {
    const data = snapshot({ audio_volume: reading, audio_volume_increment: reading });
    mockMedia.mockReturnValue(makeQuery({ data }));
    mockHistory.mockReturnValue(makeQuery({ data: [data] }));
    renderPage();

    expect(screen.getByTestId('linear-gauge')).toHaveAttribute('data-value', String(reading));
    expect(within(screen.getByTestId('linear-gauge')).getByText(reading === 0 ? '0' : reading.toFixed(2)))
      .toBeInTheDocument();
    expect(kpiValue('Volume step')).toBe(reading.toFixed(2));
    expect(screen.getByText(`${reading.toFixed(2)}/10.00`)).toBeInTheDocument();
    expect(screen.getByTestId('volume-chart')).toHaveAttribute('data-values', JSON.stringify([reading]));
    const fallback = screen.getByRole('table', { name: 'Volume over time — data table' });
    expect(within(fallback).getByRole('columnheader', { name: 'Time' })).toBeInTheDocument();
    expect(within(fallback).getByRole('columnheader', { name: 'Volume' })).toBeInTheDocument();
    expect(within(fallback).getByRole('cell', { name: String(reading), exact: true })).toBeInTheDocument();
    const figure = fallback.closest('figure');
    expect(figure).toHaveAttribute('aria-describedby', fallback.parentElement?.id);
    expect(JSON.parse(screen.getByTestId('volume-yaxis').getAttribute('data-domain') ?? 'null'))
      .toEqual([Math.min(0, reading), 10]);
    expect(screen.queryByText('No volume data for this period')).not.toBeInTheDocument();
  });

  it('keeps every finite point in the chronological fallback without sampling or rounding', () => {
    const values = Array.from({ length: 260 }, (_, index) => (index - 130) / 1000);
    const history = values.map((audio_volume, index) => snapshot({
      id: index + 1,
      audio_volume,
      created_at: new Date(Date.parse(RANGE.startInstant) + index * 1000).toISOString(),
    }));
    mockHistory.mockReturnValue(makeQuery({ data: [
      snapshot({ id: 300, audio_volume: undefined }),
      snapshot({ id: 301, audio_volume: NaN }),
      ...history.reverse(),
    ] }));
    renderPage();

    const fallback = screen.getByRole('table', { name: 'Volume over time — data table' });
    const rows = Array.from(fallback.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(values.length);
    expect(rows.map(row => row.querySelectorAll('td')[1]?.textContent)).toEqual(values.map(String));
    expect(rows.every(row => row.querySelectorAll('td')[0]?.textContent)).toBe(true);
    expect(screen.getByTestId('volume-chart')).toHaveAttribute('data-values', JSON.stringify(values));
  });
});

describe('MediaPlayerPage — error with no data', () => {
  it('surfaces the page-level banner and a retryable error wired to each refetch', () => {
    const mediaRefetch = vi.fn();
    const historyRefetch = vi.fn();
    mockMedia.mockReturnValue(
      makeQuery({ data: undefined, error: new Error('boom'), isError: true, refetch: mediaRefetch }),
    );
    mockHistory.mockReturnValue(
      makeQuery({ data: undefined, error: new Error('history down'), isError: true, refetch: historyRefetch }),
    );
    renderPage();

    // Page-level banner shows the first (media) error message.
    expect(screen.getByText('Failed to load data: boom')).toBeInTheDocument();
    expect(statsRegion()).not.toHaveAttribute('aria-busy');
    expect(within(statsRegion()).getByText('Source unavailable')).toBeInTheDocument();
    expect(within(statsRegion()).getByRole('alert')).toHaveTextContent('This source is unavailable');

    // Now-playing + volume + source + history each render a Retry CTA.
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries.length).toBeGreaterThanOrEqual(4);

    const mediaRetries = within(nowPlayingRegion()).getAllByRole('button', { name: 'Retry' });
    expect(mediaRetries).toHaveLength(2);
    fireEvent.click(mediaRetries[0]);
    expect(mediaRefetch).toHaveBeenCalledTimes(1);
    expect(historyRefetch).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('region', { name: 'Volume over time' })).getByRole('button', { name: 'Retry' }));
    expect(historyRefetch).toHaveBeenCalledTimes(1);
    expect(mediaRefetch).toHaveBeenCalledTimes(1);

    // Error wins over the empty copy — never both at once.
    expect(screen.queryByText('No playback history for this period')).not.toBeInTheDocument();
  });
});

describe('MediaPlayerPage — populated happy path', () => {
  it('renders the now-playing hero with title, artist/album, station, source, status, and progress', () => {
    renderPage();
    const region = nowPlayingRegion();

    expect(screen.getByRole('heading', { name: 'Media player', level: 1 })).toBeInTheDocument();
    expect(within(region).getByText('Now playing')).toBeInTheDocument();
    expect(within(region).getByText('Now Song')).toBeInTheDocument();
    expect(within(region).getByText(/Now Artist/)).toHaveTextContent('Now Album');
    expect(within(region).getByText('KEXP')).toBeInTheDocument();
    expect(within(region).getByText('Spotify')).toBeInTheDocument();
    expect(within(region).getByText('Playing')).toBeInTheDocument();

    const bar = within(region).getByRole('progressbar', { name: 'Playback progress' });
    expect(bar).toHaveAttribute('aria-valuemax', '185'); // 185000ms → 185s
    expect(bar).toHaveAttribute('aria-valuenow', '65'); // 65000ms → 65s
    expect(bar).toHaveTextContent('1:05'); // elapsed
    expect(bar).toHaveTextContent('3:05'); // duration
  });

  it('drives the volume gauge and its step caption from the latest snapshot', () => {
    renderPage();
    const region = nowPlayingRegion();

    const gauge = within(region).getByTestId('linear-gauge');
    expect(gauge).toHaveAttribute('data-value', '5');
    expect(gauge).toHaveAttribute('data-max', '10');
    expect(within(region).getByText(/Step:/)).toHaveTextContent('0.50');
  });

  it('renders honest KPI tiles and the source legend derived from the history aggregates', () => {
    renderPage();

    expect(kpiValue('Unique tracks')).toBe('3');
    expect(kpiValue('Top source')).toBe('Spotify');
    expect(kpiValue('Avg volume')).toBe('6'); // (4 + 8 + 6) / 3
    expect(kpiValue('Volume step')).toBe('0.50');

    // Source legend: Spotify(2) + Bluetooth(1) — the counts are unique on the page.
    expect(screen.getByText('(2)')).toBeInTheDocument();
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });

  it('renders the history table with a record count and all status labels, and wires the hooks with the string id', () => {
    renderPage();

    expect(mockMedia).toHaveBeenCalledWith('7');
    expect(mockHistory).toHaveBeenCalledWith('7', {
      start: RANGE.startInstant, end: RANGE.endInstantExclusive,
    });

    const table = screen.getByRole('table', { name: 'Playback history' });
    expect(within(table).getByText('Zeta Track')).toBeInTheDocument();
    expect(within(table).getByText('Alpha Track')).toBeInTheDocument();
    expect(within(table).getByText('Mid Track')).toBeInTheDocument();
    // statusVariant/statusLabel: playing / paused / stopped all present.
    expect(within(table).getByText('Paused')).toBeInTheDocument();
    expect(within(table).getByText('Stopped')).toBeInTheDocument();
    expect(screen.getByText(/3 records/)).toBeInTheDocument();

    // Volume gauge Y-axis ceiling matches the known max (peak 8, latest max 10).
    expect(JSON.parse(screen.getByTestId('volume-yaxis').getAttribute('data-domain') ?? 'null')).toEqual([0, 10]);
  });

  it('formats history volume levels with the configured precision and preserves missing values', () => {
    setGlobalPrecision(1);
    mockHistory.mockReturnValue(
      makeQuery({
        data: [
          snapshot({
            id: 1,
            audio_volume: 5.666666507720947,
            audio_volume_max: 10.333333015441895,
          }),
          snapshot({
            id: 2,
            audio_volume: undefined,
            audio_volume_max: undefined,
          }),
        ],
      }),
    );

    renderPage();

    expect(screen.getByText('5.7/10.3')).toBeInTheDocument();
    expect(screen.getByText('—/—')).toBeInTheDocument();
    expect(screen.queryByText('5.666666507720947/10.333333015441895')).not.toBeInTheDocument();
  });
});

describe('MediaPlayerPage — avgVolume excludes missing readings (bug fix)', () => {
  it('averages only snapshots that carry a volume, not treating a missing field as 0', () => {
    // Two real readings (3, 9) + two rows with no volume. Honest mean = 6.
    // The old code divided the 12 total by all 4 rows → 3.
    mockMedia.mockReturnValue(makeQuery({ data: undefined }));
    mockHistory.mockReturnValue(
      makeQuery({
        data: [
          snapshot({ id: 1, now_playing_title: 'A', audio_volume: 3, created_at: '2026-06-10T10:00:00Z' }),
          snapshot({ id: 2, now_playing_title: 'B', audio_volume: 9, created_at: '2026-06-11T10:00:00Z' }),
          snapshot({ id: 3, now_playing_title: 'C', audio_volume: undefined, created_at: '2026-06-12T10:00:00Z' }),
          snapshot({ id: 4, now_playing_title: 'D', audio_volume: undefined, created_at: '2026-06-13T10:00:00Z' }),
        ],
      }),
    );
    renderPage();

    expect(kpiValue('Avg volume')).toBe('6');
    expect(kpiValue('Avg volume')).not.toBe('3');
  });
});

describe('MediaPlayerPage — volume chart excludes missing readings (bug fix)', () => {
  it('charts only snapshots that carry a volume, never phantom drops to 0', () => {
    mockMedia.mockReturnValue(makeQuery({ data: undefined }));
    mockHistory.mockReturnValue(
      makeQuery({
        data: [
          snapshot({ id: 1, now_playing_title: 'A', audio_volume: 3, created_at: '2026-06-10T10:00:00Z' }),
          snapshot({ id: 2, now_playing_title: 'B', audio_volume: undefined, created_at: '2026-06-11T10:00:00Z' }),
          snapshot({ id: 3, now_playing_title: 'C', audio_volume: 9, created_at: '2026-06-12T10:00:00Z' }),
        ],
      }),
    );
    renderPage();

    // Two charted points (the volumeless row is dropped, not zeroed).
    expect(screen.getByTestId('volume-chart')).toHaveAttribute('data-points', '2');
  });

  it('shows the no-volume empty state when no snapshot carries a reading', () => {
    mockMedia.mockReturnValue(makeQuery({ data: undefined }));
    mockHistory.mockReturnValue(
      makeQuery({
        data: [
          snapshot({ id: 1, now_playing_title: 'A', audio_volume: undefined, created_at: '2026-06-10T10:00:00Z' }),
        ],
      }),
    );
    renderPage();

    expect(screen.getByText('No volume data for this period')).toBeInTheDocument();
    expect(screen.queryByTestId('volume-chart')).not.toBeInTheDocument();
  });
});

describe('MediaPlayerPage — playback progress hardening (bug fix)', () => {
  it.each([
    [250, 125, '0.25', '0.125'],
    [1499, 749, '1.499', '0.749'],
  ])('keeps positive fractional ARIA bounds for %sms duration despite visual rounding', (duration, elapsed, max, now) => {
    mockMedia.mockReturnValue(makeQuery({
      data: snapshot({
        now_playing_duration: duration,
        now_playing_elapsed: elapsed,
        playback_status: 'Playing',
      }),
    }));
    renderPage();

    const bar = within(nowPlayingRegion()).getByRole('progressbar', { name: 'Playback progress' });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', max);
    expect(bar).toHaveAttribute('aria-valuenow', now);
    expect(bar).toHaveTextContent('0:00');
    expect(bar).toHaveTextContent(duration < 1000 ? '0:00' : '0:01');
    expect(screen.queryByText('Playback progress is unavailable without a reported elapsed time and positive duration.'))
      .not.toBeInTheDocument();
  });

  it('clamps a negative elapsed to 0:00 and reports aria-valuenow 0 instead of a negative value', () => {
    mockMedia.mockReturnValue(
      makeQuery({
        data: snapshot({
          now_playing_title: 'Edge',
          now_playing_duration: 100000, // 1:40
          now_playing_elapsed: -5000, // malformed / negative
          playback_status: 'Playing',
        }),
      }),
    );
    renderPage();

    const bar = within(nowPlayingRegion()).getByRole('progressbar', { name: 'Playback progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveTextContent('0:00'); // NOT "-1:-05"
    expect(bar.textContent ?? '').not.toContain('-1');
  });
});

describe('MediaPlayerPage — volume axis ceiling (bug fix)', () => {
  it('derives the Y-axis max from the charted peak when the latest snapshot is missing', () => {
    // No current snapshot, but history peaks at 30 — the old domain pinned to the
    // fallback (11) and clipped the peak. The fix scales the axis to the data.
    mockMedia.mockReturnValue(makeQuery({ data: undefined }));
    mockHistory.mockReturnValue(
      makeQuery({
        data: [
          snapshot({ id: 1, now_playing_title: 'A', audio_volume: 10, audio_volume_max: undefined, created_at: '2026-06-10T10:00:00Z' }),
          snapshot({ id: 2, now_playing_title: 'B', audio_volume: 30, audio_volume_max: undefined, created_at: '2026-06-11T10:00:00Z' }),
          snapshot({ id: 3, now_playing_title: 'C', audio_volume: 20, audio_volume_max: undefined, created_at: '2026-06-12T10:00:00Z' }),
        ],
      }),
    );
    renderPage();

    expect(JSON.parse(screen.getByTestId('volume-yaxis').getAttribute('data-domain') ?? 'null')).toEqual([0, 30]);
  });
});

describe('MediaPlayerPage — source icon and status branches', () => {
  it('renders FM radio, podcast, and aux rows without inventing Stopped for an unknown source status', () => {
    mockMedia.mockReturnValue(makeQuery({ data: undefined }));
    mockHistory.mockReturnValue(
      makeQuery({
        data: [
          snapshot({ id: 1, now_playing_title: 'Morning Show', playback_source: 'FM Radio', playback_status: 'buffering', created_at: '2026-06-10T10:00:00Z' }),
          snapshot({ id: 2, now_playing_title: 'Daily Pod', playback_source: 'Podcast App', playback_status: 'paused', created_at: '2026-06-11T10:00:00Z' }),
          snapshot({ id: 3, now_playing_title: 'Mixtape', playback_source: 'AUX', playback_status: 'playing', created_at: '2026-06-12T10:00:00Z' }),
        ],
      }),
    );
    renderPage();

    const table = screen.getByRole('table', { name: 'Playback history' });
    expect(within(table).getByText('FM Radio')).toBeInTheDocument();
    expect(within(table).getByText('Podcast App')).toBeInTheDocument();
    expect(within(table).getByText('AUX')).toBeInTheDocument();
    expect(within(table).getByText('buffering')).toBeInTheDocument();
    expect(within(table).queryByText('Stopped')).not.toBeInTheDocument();
    expect(within(table).getByText('Paused')).toBeInTheDocument();
    expect(within(table).getByText('Playing')).toBeInTheDocument();
  });
});

describe('MediaPlayerPage — interactions', () => {
  it.each([
    {
      startInstant: '2026-06-10T15:42:19.125Z',
      endInstantExclusive: '2026-06-11T15:42:19.125Z',
    },
    {
      startInstant: '2026-06-10T00:00:00-07:00',
      endInstantExclusive: '2026-06-12T00:00:00-07:00',
    },
    {
      startInstant: '2024-03-09T00:00:00-08:00',
      endInstantExclusive: '2024-03-11T00:00:00-07:00',
    },
  ])('uses identical half-open bounds in every history surface: $startInstant', (range) => {
    mockRange.mockReturnValue({ ...RANGE, ...range, setRange: vi.fn() });
    const startMs = Date.parse(range.startInstant);
    const endMs = Date.parse(range.endInstantExclusive);
    mockHistory.mockReturnValue(makeQuery({ data: [
      snapshot({ id: 1, created_at: new Date(startMs - 1).toISOString(), now_playing_title: 'Before range', audio_volume: 99, playback_source: 'Excluded source' }),
      snapshot({ id: 2, created_at: new Date(startMs).toISOString(), now_playing_title: 'At lower bound', audio_volume: 4 }),
      snapshot({ id: 3, created_at: new Date(endMs - 1).toISOString(), now_playing_title: 'Before upper bound', audio_volume: 8 }),
      snapshot({ id: 4, created_at: range.endInstantExclusive, now_playing_title: 'At upper bound', audio_volume: 99, playback_source: 'Excluded source' }),
      snapshot({ id: 5, created_at: 'invalid', now_playing_title: 'Unknown timestamp', audio_volume: 99, playback_source: 'Excluded source' }),
    ] }));
    renderPage();
    expect(mockHistory).toHaveBeenCalledWith('7', {
      start: range.startInstant, end: range.endInstantExclusive,
    });
    expect(bodyRows()).toHaveLength(2);
    expect(screen.getByText(/2 records/)).toBeInTheDocument();
    expect(screen.queryByText('Before range')).not.toBeInTheDocument();
    expect(screen.queryByText('At upper bound')).not.toBeInTheDocument();
    expect(screen.queryByText('Unknown timestamp')).not.toBeInTheDocument();
    expect(screen.queryByText('Excluded source')).not.toBeInTheDocument();
    expect(kpiValue('Unique tracks')).toBe('2');
    expect(kpiValue('Avg volume')).toBe('6');
    expect(kpiValue('Top source')).toBe('Spotify');
    expect(screen.getByTestId('volume-chart')).toHaveAttribute('data-values', '[4,8]');
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });

  it('reads the shared range without rendering a second range trigger', () => {
    const setRange = vi.fn();
    mockRange.mockReturnValue({ ...RANGE, setRange });
    renderPage();

    expect(screen.queryByTestId('media-player-range')).not.toBeInTheDocument();
    expect(setRange).not.toHaveBeenCalled();
  });

  it('reorders the table and toggles direction when the Track column header is sorted', () => {
    renderPage();

    // Default order is created_at desc → Mid (06-12) is first.
    expect(bodyRows()[0]).toHaveTextContent('Mid Track');

    // First Track sort → desc by title → Zeta > Mid > Alpha.
    fireEvent.click(screen.getByRole('button', { name: 'Track' }));
    expect(bodyRows()[0]).toHaveTextContent('Zeta Track');

    // Second click toggles to asc → Alpha first.
    fireEvent.click(screen.getByRole('button', { name: 'Track' }));
    expect(bodyRows()[0]).toHaveTextContent('Alpha Track');
  });
});

describe('MediaPlayerPage — independent retained source recovery', () => {
  it.each(['history', 'latest'] as const)('does not hide returned metrics while %s initially loads', loadingSource => {
    const loadingQuery = makeQuery({ data: undefined, isLoading: true, isPending: true, fetchStatus: 'fetching' });
    if (loadingSource === 'history') mockHistory.mockReturnValue(loadingQuery);
    else mockMedia.mockReturnValue(loadingQuery);
    renderPage();

    expect(statsRegion()).not.toHaveAttribute('aria-busy');
    expect(within(statsRegion()).getByText('Returned evidence')).toBeInTheDocument();
    expect(kpiValue('Unique tracks')).toBe(loadingSource === 'history' ? '—' : '3');
    expect(kpiValue('Avg volume')).toBe(loadingSource === 'history' ? '—' : '6');
    expect(kpiValue('Volume step')).toBe(loadingSource === 'latest' ? '—' : '0.50');
  });

  it('retains successful empty history and a zero live step through refresh failure and recovery', () => {
    const zero = { ...LATEST, audio_volume_increment: 0 };
    mockMedia.mockReturnValue(makeQuery({ data: zero }));
    mockHistory.mockReturnValue(makeQuery({ data: [] }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = () => <MemoryRouter initialEntries={['/media-player']}>
      <QueryClientProvider client={client}><MediaPlayerPage /></QueryClientProvider>
    </MemoryRouter>;
    const view = render(ui());
    expect(kpiValue('Unique tracks')).toBe('0');
    expect(kpiValue('Volume step')).toBe('0.00');
    expect(kpiValue('Top source')).toBe('—');
    expect(kpiValue('Avg volume')).toBe('—');

    mockMedia.mockReturnValue(makeQuery({ data: zero, error: new Error('Live refresh failed'), isError: true }));
    mockHistory.mockReturnValue(makeQuery({ data: [], error: new Error('History refresh failed'), isError: true }));
    view.rerender(ui());
    expect(statsRegion()).not.toHaveAttribute('aria-busy');
    expect(within(statsRegion()).getAllByText('Retained evidence').length).toBeGreaterThan(0);
    expect(within(statsRegion()).queryByRole('alert')).not.toBeInTheDocument();
    expect(kpiValue('Unique tracks')).toBe('0');
    expect(kpiValue('Volume step')).toBe('0.00');
    expect(statsRegion().parentElement).toHaveAttribute('data-source-retained', 'true');

    mockMedia.mockReturnValue(makeQuery({ data: zero }));
    mockHistory.mockReturnValue(makeQuery({ data: [] }));
    view.rerender(ui());
    expect(within(statsRegion()).getByText('Returned evidence')).toBeInTheDocument();
    expect(statsRegion().parentElement).not.toHaveAttribute('data-source-retained');
    expect(kpiValue('Unique tracks')).toBe('0');
    expect(kpiValue('Volume step')).toBe('0.00');
  });

  it.each(['history', 'latest'] as const)('keeps returned metrics when only %s is unavailable', (unavailableSource) => {
    const failed = makeQuery({ isError: true, error: new Error('Independent source failed') });
    if (unavailableSource === 'history') mockHistory.mockReturnValue(failed);
    else mockMedia.mockReturnValue(failed);
    renderPage();

    expect(within(statsRegion()).getByText('Returned evidence')).toBeInTheDocument();
    expect(within(statsRegion()).getByText('Not a live-state observation')).toBeInTheDocument();
    expect(kpiValue('Unique tracks')).toBe(unavailableSource === 'history' ? '—' : '3');
    expect(kpiValue('Top source')).toBe(unavailableSource === 'history' ? '—' : 'Spotify');
    expect(kpiValue('Avg volume')).toBe(unavailableSource === 'history' ? '—' : '6');
    expect(kpiValue('Volume step')).toBe(unavailableSource === 'latest' ? '—' : '0.50');
    for (const id of ['media-unique-tracks', 'media-top-source', 'media-average-volume']) {
      const metric = statsRegion().querySelector(`[data-operational-metric="${id}"]`);
      expect(metric).toHaveTextContent(unavailableSource === 'history' ? 'This source is unavailable' : 'Partial evidence');
      expect(metric).not.toHaveTextContent('Latest media snapshot');
    }
    const step = statsRegion().querySelector('[data-operational-metric="media-volume-step"]');
    expect(step).toHaveTextContent('Latest media snapshot');
    expect(step).not.toHaveTextContent('Partial evidence');
    if (unavailableSource === 'latest') expect(step).toHaveTextContent('This source is unavailable');
    else expect(step).not.toHaveTextContent('This source is unavailable');
  });

  it('preserves the user sort and every retained history row when live metadata alone recovers', () => {
    const liveRetry = vi.fn();
    const historyRetry = vi.fn();
    mockMedia.mockReturnValue(makeQuery({
      data: LATEST, isError: true, error: new Error('Live refresh failed'), refetch: liveRetry,
    }));
    mockHistory.mockReturnValue(makeQuery({
      data: HISTORY, isError: true, error: new Error('History refresh failed'), refetch: historyRetry,
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = () => <MemoryRouter initialEntries={['/media-player']}>
      <QueryClientProvider client={client}><MediaPlayerPage /></QueryClientProvider>
    </MemoryRouter>;
    const view = render(ui());
    fireEvent.click(screen.getByRole('button', { name: 'Track' }));
    fireEvent.click(screen.getByRole('button', { name: 'Track' }));
    expect(bodyRows()[0]).toHaveTextContent('Alpha Track');
    expect(bodyRows()).toHaveLength(3);
    expect(kpiValue('Unique tracks')).toBe('3');
    expect(kpiValue('Avg volume')).toBe('6');
    expect(within(nowPlayingRegion()).getByRole('progressbar', { name: 'Playback progress' }))
      .toHaveAttribute('aria-valuenow', '65');
    const hero = screen.getByText('Now Song').closest<HTMLElement>('[data-card]');
    if (!hero) throw new Error('Missing now-playing card');
    fireEvent.click(within(hero).getByRole('button', { name: 'Retry' }));
    expect(liveRetry).toHaveBeenCalledOnce();
    expect(historyRetry).not.toHaveBeenCalled();

    mockMedia.mockReturnValue(makeQuery({
      data: { ...LATEST, now_playing_title: 'Recovered live track', playback_status: 'Paused' },
      refetch: liveRetry,
    }));
    view.rerender(ui());
    expect(within(nowPlayingRegion()).getByText('Recovered live track')).toBeInTheDocument();
    expect(within(hero).queryByText(/Previously loaded data remains visible/)).not.toBeInTheDocument();
    expect(bodyRows()[0]).toHaveTextContent('Alpha Track');
    expect(bodyRows()).toHaveLength(3);
    expect(kpiValue('Top source')).toBe('Spotify');
    expect(screen.getByTestId('volume-chart')).toHaveAttribute('data-points', '3');
    expect(screen.getAllByText(/History refresh failed/).length).toBeGreaterThan(0);
    fireEvent.click(within(screen.getByRole('region', { name: 'Volume over time' }))
      .getByRole('button', { name: 'Retry' }));
    expect(historyRetry).toHaveBeenCalledOnce();
    expect(liveRetry).toHaveBeenCalledTimes(1);
  });

  it('retains a real zero live volume step during pause, then reports missing live readings without clearing history', () => {
    const zero = { ...LATEST, audio_volume: 0, audio_volume_increment: 0, now_playing_elapsed: 0 };
    mockMedia.mockReturnValue(makeQuery({ data: zero, fetchStatus: 'paused' }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = () => <MemoryRouter initialEntries={['/media-player']}>
      <QueryClientProvider client={client}><MediaPlayerPage /></QueryClientProvider>
    </MemoryRouter>;
    const view = render(ui());
    expect(kpiValue('Volume step')).toBe('0.00');
    expect(within(nowPlayingRegion()).getByTestId('linear-gauge')).toHaveAttribute('data-value', '0');
    expect(within(nowPlayingRegion()).getByRole('progressbar', { name: 'Playback progress' }))
      .toHaveAttribute('aria-valuenow', '0');
    expect(statsRegion().parentElement).toHaveAttribute('data-source-retained', 'true');
    expect(screen.getByText('The device is offline, so this section is showing the last values it received.'))
      .toBeInTheDocument();
    expect(screen.queryByText('Refresh failed; previously loaded data remains visible for the affected source.'))
      .not.toBeInTheDocument();

    mockMedia.mockReturnValue(makeQuery({
      data: {
        ...zero, audio_volume: null, audio_volume_increment: null,
        now_playing_elapsed: null, now_playing_duration: null, playback_status: null,
      },
    }));
    view.rerender(ui());
    expect(kpiValue('Volume step')).toBe('—');
    expect(within(nowPlayingRegion()).getByText('Unknown status')).toBeInTheDocument();
    expect(within(nowPlayingRegion()).queryByRole('progressbar', { name: 'Playback progress' }))
      .not.toBeInTheDocument();
    expect(within(nowPlayingRegion()).getByText(/Playback progress is unavailable/)).toBeInTheDocument();
    expect(kpiValue('Unique tracks')).toBe('3');
    expect(kpiValue('Avg volume')).toBe('6');
    expect(bodyRows()).toHaveLength(3);
    expect(statsRegion().parentElement).not.toHaveAttribute('data-source-retained');
    expect(screen.queryByText('The device is offline, so this section is showing the last values it received.'))
      .not.toBeInTheDocument();
    expect(zero.audio_volume).toBe(0);
    expect(zero.now_playing_elapsed).toBe(0);
  });
});


describe('MediaPlayerPage — restrained source presentation', () => {
  it('keeps every source glyph decorative and theme-aware without changing its label', () => {
    renderPage();
    for (const label of within(nowPlayingRegion()).getAllByText('Spotify')) {
      const icon = label.parentElement?.querySelector('svg');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(icon).toHaveAttribute('focusable', 'false');
      expect(icon).toHaveClass('text-[var(--text-secondary)]');
      expect(icon?.getAttribute('class')).not.toMatch(/text-(emerald|indigo|amber|purple|cyan)-300/);
    }
    expect(bodyRows()).toHaveLength(3);
    expect(kpiValue('Top source')).toBe('Spotify');
  });

  it('keeps all section shells and source-shaped skeletons mounted without an ambient pulse', () => {
    mockMedia.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    mockHistory.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    const { container } = renderPage();
    for (const name of ['Now playing', 'Volume', 'Volume over time', 'Source distribution', 'Playback history']) {
      expect(screen.getByRole('heading', { name, level: 3 })).toBeInTheDocument();
    }
    expect(statsRegion()).toBeInTheDocument();
    expect(container.querySelector('[class*="--skeleton-bg"]')).toBeTruthy();
    expect(container.querySelector('[class*="animate-pulse"]')).toBeNull();
    expect(screen.queryByTestId('volume-chart')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: 'Playback progress' })).not.toBeInTheDocument();
    expect(kpiValue('Unique tracks')).toBe('—');
  });
});
