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
 *   - `RadialGauge` echoes `value`/`max` so the volume gauge wiring is assertable.
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
 *   - fmtPlayTime + progressbar aria bug fix: a negative elapsed clamps to 0:00
 *     and aria-valuenow 0 instead of rendering "-1:-05" / a negative value.
 *   - volume-axis clip bug fix: when the latest snapshot is missing, the Y-axis
 *     ceiling comes from the charted peak instead of the small fallback.
 *   - source-icon / status branches: FM radio, podcast, and aux sources render
 *     alongside an unknown status that maps to "Stopped".
 *   - interactions: the range trigger commits a new range via setRange; sorting
 *     the Track column reorders the table and toggles direction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { MediaSnapshot } from '@/api/types';

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
vi.mock('@/components/charts', () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const Null = () => null;
  return {
    CHART_COLORS: ['#06b6d4', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'],
    chartGrid: {},
    axisTickSm: {},
    ChartTooltip: Null,
    ChartGradient: Null,
    ResponsiveContainer: Passthrough,
    // Real <svg> so the page's <defs> gradient node is valid markup (no
    // "unrecognized tag" warning) while children still mount.
    AreaChart: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
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
    RadialGauge: ({ value, max, label }: { value?: number; max?: number; label?: string }) => (
      <div data-testid="radial-gauge" data-value={String(value)} data-max={String(max)} aria-label={label} />
    ),
  };
});

// ── forms row: VehicleSelect is a bare marker; RangePicker is a single trigger
//    that commits a fixed range so the parent's setRange wiring is assertable. ──
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

const RANGE = { start: '2026-06-01', end: '2026-06-30' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

/** Read a KPI MetricCard's value <p> given its label, scoped to the KPI band. */
function kpiValue(label: string): string {
  const span = within(statsRegion()).getByText(label);
  return span.closest('p')?.nextElementSibling?.textContent ?? '';
}

/** Non-spacer <tbody> rows of the playback-history table. */
function bodyRows(): HTMLElement[] {
  const table = screen.getByRole('table');
  return Array.from(table.querySelectorAll('tbody tr')).filter(
    (r) => !r.hasAttribute('aria-hidden'),
  ) as HTMLElement[];
}

beforeEach(() => {
  mockMedia.mockReset();
  mockHistory.mockReset();
  mockSelected.mockReset();
  mockRange.mockReset();

  mockRange.mockReturnValue({ start: RANGE.start, end: RANGE.end, setRange: vi.fn() });
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

    expect(screen.getByText(/Select a vehicle to see what.s playing/)).toBeInTheDocument();
    expect(screen.getByText('Select a vehicle to view volume history')).toBeInTheDocument();
    expect(screen.getByText('Select a vehicle to view sources')).toBeInTheDocument();
    expect(screen.getByText('Select a vehicle to view playback history')).toBeInTheDocument();

    // KPIs collapse to honest placeholders, not stale numbers.
    expect(kpiValue('Unique Tracks')).toBe('0');
    expect(kpiValue('Top Source')).toBe('—');
    expect(kpiValue('Avg Volume')).toBe('0');

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

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByText('No volume data for this period')).not.toBeInTheDocument();
    expect(screen.queryByText('No playback history for this period')).not.toBeInTheDocument();
    // Aggregates are withheld while the first load is in flight (no data yet).
    expect(kpiValue('Unique Tracks')).toBe('0');
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
    expect(screen.getByText(/Failed to load data/)).toHaveTextContent('boom');

    // Now-playing + volume + source + history each render a Retry CTA.
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries.length).toBeGreaterThanOrEqual(4);

    // First Retry belongs to the now-playing (media) panel; a later one to a
    // history-backed panel — each re-invokes its own query's refetch.
    fireEvent.click(retries[0]);
    expect(mediaRefetch).toHaveBeenCalledTimes(1);
    fireEvent.click(retries[1]);
    expect(historyRefetch).toHaveBeenCalledTimes(1);

    // Error wins over the empty copy — never both at once.
    expect(screen.queryByText('No playback history for this period')).not.toBeInTheDocument();
  });
});

describe('MediaPlayerPage — populated happy path', () => {
  it('renders the now-playing hero with title, artist/album, station, source, status, and progress', () => {
    renderPage();
    const region = nowPlayingRegion();

    expect(screen.getByRole('heading', { name: 'Media Player', level: 1 })).toBeInTheDocument();
    expect(within(region).getByText('Now Playing')).toBeInTheDocument();
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

    const gauge = within(region).getByTestId('radial-gauge');
    expect(gauge).toHaveAttribute('data-value', '5');
    expect(gauge).toHaveAttribute('data-max', '10');
    expect(within(region).getByText(/Step:/)).toHaveTextContent('0.50');
  });

  it('renders honest KPI tiles and the source legend derived from the history aggregates', () => {
    renderPage();

    expect(kpiValue('Unique Tracks')).toBe('3');
    expect(kpiValue('Top Source')).toBe('Spotify');
    expect(kpiValue('Avg Volume')).toBe('6'); // (4 + 8 + 6) / 3
    expect(kpiValue('Volume Step')).toBe('0.50');

    // Source legend: Spotify(2) + Bluetooth(1) — the counts are unique on the page.
    expect(screen.getByText('(2)')).toBeInTheDocument();
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });

  it('renders the history table with a record count and all status labels, and wires the hooks with the string id', () => {
    renderPage();

    expect(mockMedia).toHaveBeenCalledWith('7');
    expect(mockHistory).toHaveBeenCalledWith('7', { start: RANGE.start, end: RANGE.end });

    const table = screen.getByRole('table');
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

    expect(kpiValue('Avg Volume')).toBe('6');
    expect(kpiValue('Avg Volume')).not.toBe('3');
  });
});

describe('MediaPlayerPage — playback progress hardening (bug fix)', () => {
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
  it('renders FM radio, podcast, and aux rows alongside an unknown status that maps to Stopped', () => {
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

    const table = screen.getByRole('table');
    expect(within(table).getByText('FM Radio')).toBeInTheDocument();
    expect(within(table).getByText('Podcast App')).toBeInTheDocument();
    expect(within(table).getByText('AUX')).toBeInTheDocument();
    // "buffering" is not playing/paused → statusLabel falls through to Stopped.
    expect(within(table).getByText('Stopped')).toBeInTheDocument();
    expect(within(table).getByText('Paused')).toBeInTheDocument();
    expect(within(table).getByText('Playing')).toBeInTheDocument();
  });
});

describe('MediaPlayerPage — interactions', () => {
  it('commits a new range through setRange when the range trigger fires', () => {
    const setRange = vi.fn();
    mockRange.mockReturnValue({ start: RANGE.start, end: RANGE.end, setRange });
    renderPage();

    fireEvent.click(screen.getByTestId('media-player-range'));
    expect(setRange).toHaveBeenCalledWith({ start: '2026-06-05', end: '2026-06-20' });
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
