/**
 * LiveSignalSparklinesWidget contract + hardening tests.
 *
 * The widget is a self-refreshing dashboard tile that renders one row per
 * "live" vehicle signal: a coloured swatch, the current value, a compact
 * Sparkline of the last hour of history, and a trend arrow. Its whole shape is
 * a function of four inputs: the resolved vehicle id (`vehicleId` prop, else the
 * first fleet vehicle, else 0), the `/signals/{id}/available` catalogue, the
 * `/signals/{id}/live` snapshot, and a per-signal `/signals/{id}/{name}/history`
 * series — all intersected with the (optional) configured signal list and the
 * widget `size`:
 *
 *   - size.cols >= 3 && >3 signals → two-column grid + 80px sparklines.
 *   - otherwise                    → single column + 56px sparklines.
 *   - no configured signals resolve → the accessible empty state.
 *   - isLoading                     → skeleton chrome only.
 *
 * The suite locks, facet by facet:
 *   1. The three exported pure helpers: `formatSignalName` (PascalCase → words,
 *      acronym grouping), `extractNumericValue` (finite-number / numeric-string
 *      coercion + rejection of everything else), and the `SIGNAL_COLORS` palette
 *      (regression-pins the fix where a mislabelled NEON index made two rows
 *      share the same emerald — the palette must now be six DISTINCT colours).
 *   2. Full view: a row per available default signal with a formatted label, the
 *      live value through `fmtNumber` (numeric strings coerced, missing → "—"),
 *      a sparkline only where >=2 history points exist, an accessible per-signal
 *      sparkline label, and an accessible trend arrow (up / down / no-change).
 *      Hook URLs are path-based with NO `/api/v1` double-prefix.
 *   3. Layout: two columns + 80px sparklines when wide; one column + 56px narrow.
 *   4. Configured signals are intersected with the available catalogue; when the
 *      catalogue is empty the defaults are kept as placeholders.
 *   5. Empty (no signals resolve) → accessible empty state, never bare rows.
 *   6. Loading → skeleton only.
 *   7. No vehicle → every query disabled and the network is never touched.
 *   8. Failure path → a dead `/live` query dashes the values instead of crashing.
 *   9. Refresh: the accessible "Refresh" freshness control refetches `/live`.
 *
 * i18n is stubbed to echo the English fallback so copy is deterministic;
 * `@/api/hooks/useVehicles` and the shared `request` seam are mocked so no
 * network is touched. The real telemetry hooks + the real inline-SVG Sparkline
 * run so URL construction, catalogue normalisation, and rendering are exercised
 * end-to-end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// i18n passthrough: honour the English fallback so every copy assertion is real.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown) =>
      typeof defaultValue === 'string' ? defaultValue : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// Fleet list injected per-test through a mutable holder.
let MOCK_VEHICLES: { data: Vehicle[] | undefined };
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => MOCK_VEHICLES,
}));

// Neutralise the shared fetch seam; keep ApiError/isApiError etc. real.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

import LiveSignalSparklinesWidget, {
  formatSignalName,
  extractNumericValue,
  SIGNAL_COLORS,
} from './LiveSignalSparklinesWidget';
import { request } from '@/api/client';
import { fmtNumber } from '@/lib/numberFormat';
import type { WidgetSize } from './types';
import type { Vehicle } from '@/types/vehicle';

// The generic `request<T>` fights `mockResolvedValue`'s inference; the repo's
// convention is to treat it as a plain untyped mock at the call site.
const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

const FULL: WidgetSize = { cols: 4, rows: 3 };
const NARROW: WidgetSize = { cols: 2, rows: 2 };

const DEFAULTS = [
  'BatteryLevel',
  'VehicleSpeed',
  'OutsideTemp',
  'InsideTemp',
  'Odometer',
  'PackCurrent',
];

type LiveSnapshot = Record<string, { value: unknown; timestamp: string }>;
type HistoryPoints = { timestamp: string; valueNum?: number }[];

let AVAILABLE: string[];
let LIVE: LiveSnapshot;
let HISTORY: Record<string, HistoryPoints>;

// Route the shared `request` seam by URL so the real telemetry hooks resolve
// against the per-test AVAILABLE / LIVE / HISTORY fixtures.
function wire() {
  mockedRequest.mockImplementation((url: string) => {
    if (typeof url !== 'string') return Promise.resolve({});
    if (url.endsWith('/available')) return Promise.resolve({ signals: AVAILABLE });
    if (url.endsWith('/live')) return Promise.resolve({ signals: LIVE });
    const m = url.match(/^\/signals\/\d+\/([^/]+)\/history/);
    if (m) return Promise.resolve({ data: HISTORY[decodeURIComponent(m[1])] ?? [] });
    return Promise.resolve({});
  });
}

function calledWithUrl(url: string): boolean {
  return mockedRequest.mock.calls.some((c) => c[0] === url);
}

function liveCallCount(): number {
  return mockedRequest.mock.calls.filter((c) => String(c[0]).endsWith('/live')).length;
}

function points(...vals: number[]): HistoryPoints {
  return vals.map((v, i) => ({ timestamp: `2026-07-01T0${i}:00:00Z`, valueNum: v }));
}

function fleet(...ids: number[]): { data: Vehicle[] } {
  return { data: ids.map((id) => ({ id })) as unknown as Vehicle[] };
}

function renderWidget(size: WidgetSize, vehicleId?: number, config?: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LiveSignalSparklinesWidget vehicleId={vehicleId} size={size} config={config} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  MOCK_VEHICLES = { data: [] };
  AVAILABLE = [];
  LIVE = {};
  HISTORY = {};
  mockedRequest.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('formatSignalName', () => {
  it('splits PascalCase signal names into spaced words', () => {
    expect(formatSignalName('BatteryLevel')).toBe('Battery Level');
    expect(formatSignalName('VehicleSpeed')).toBe('Vehicle Speed');
    expect(formatSignalName('PackCurrent')).toBe('Pack Current');
  });

  it('groups a leading acronym and leaves single words untouched', () => {
    expect(formatSignalName('SOCPercent')).toBe('SOC Percent');
    expect(formatSignalName('Odometer')).toBe('Odometer');
    expect(formatSignalName('')).toBe('');
  });
});

describe('extractNumericValue', () => {
  it('passes finite numbers through and parses numeric strings', () => {
    expect(extractNumericValue(42)).toBe(42);
    expect(extractNumericValue(0)).toBe(0);
    expect(extractNumericValue(-3.2)).toBe(-3.2);
    expect(extractNumericValue('55.4')).toBe(55.4);
  });

  it('returns null for non-finite, non-numeric and non-primitive input', () => {
    expect(extractNumericValue(Number.NaN)).toBeNull();
    expect(extractNumericValue(Number.POSITIVE_INFINITY)).toBeNull();
    expect(extractNumericValue('not-a-number')).toBeNull();
    expect(extractNumericValue(null)).toBeNull();
    expect(extractNumericValue(undefined)).toBeNull();
    expect(extractNumericValue(true)).toBeNull();
  });
});

describe('SIGNAL_COLORS palette', () => {
  it('exposes six distinct colours (no accidental duplicates)', () => {
    expect(SIGNAL_COLORS).toHaveLength(6);
    expect(new Set(SIGNAL_COLORS).size).toBe(6);
  });

  it('matches the documented cyan/purple/amber/emerald/blue/rose order', () => {
    expect(SIGNAL_COLORS).toEqual([
      '#00f0ff',
      '#a855f7',
      '#f59e0b',
      '#10b981',
      '#3b82f6',
      '#f43f5e',
    ]);
  });
});

describe('LiveSignalSparklinesWidget — full view', () => {
  it('renders a value + sparkline + accessible trend for each available default signal', async () => {
    AVAILABLE = [...DEFAULTS];
    LIVE = {
      BatteryLevel: { value: 82, timestamp: 't' },
      VehicleSpeed: { value: '55.4', timestamp: 't' }, // numeric string is coerced
      OutsideTemp: { value: 15, timestamp: 't' },
      PackCurrent: { value: -3.2, timestamp: 't' },
      // InsideTemp + Odometer intentionally absent → "—"
    };
    HISTORY = {
      BatteryLevel: points(10, 20, 30, 40), // rising → up
      VehicleSpeed: points(40, 30, 20, 10), // falling → down
      OutsideTemp: points(20, 20, 20, 20), // flat, >=2 → sparkline
      PackCurrent: points(1, 2), // flat (<4 pts), >=2 → sparkline
      InsideTemp: points(5), // 1 point → no sparkline
      Odometer: [], // 0 points → no sparkline
    };
    wire();
    renderWidget(FULL, 1);

    expect(await screen.findByText('Live Signal Sparklines')).toBeInTheDocument();

    // Hook URLs are path-based with NO /api/v1 double-prefix.
    await waitFor(() => expect(calledWithUrl('/signals/1/available')).toBe(true));
    expect(calledWithUrl('/signals/1/live')).toBe(true);
    expect(calledWithUrl('/signals/1/BatteryLevel/history?hours=1')).toBe(true);

    // Every configured signal renders a formatted label.
    expect(screen.getByText('Battery Level')).toBeInTheDocument();
    expect(screen.getByText('Vehicle Speed')).toBeInTheDocument();
    expect(screen.getByText('Outside Temp')).toBeInTheDocument();
    expect(screen.getByText('Inside Temp')).toBeInTheDocument();
    expect(screen.getByText('Odometer')).toBeInTheDocument();
    expect(screen.getByText('Pack Current')).toBeInTheDocument();

    // Live values go through fmtNumber; the numeric string is coerced; the two
    // signals absent from the /live snapshot dash out.
    expect(screen.getByText(fmtNumber(82, 1))).toBeInTheDocument();
    expect(screen.getByText(fmtNumber(55.4, 1))).toBeInTheDocument();
    expect(screen.getByText(fmtNumber(-3.2, 1))).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);

    // Sparklines render only where there are >=2 history points; the rest fall
    // back to the "no data" placeholder.
    expect(await screen.findByRole('img', { name: 'Battery Level trend' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Pack Current trend' })).toBeInTheDocument();
    expect(screen.getAllByText('no data')).toHaveLength(2);

    // The icon-only trend arrows announce their direction to assistive tech.
    expect(screen.getByRole('img', { name: 'Trending up' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Trending down' })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'No change' })).toHaveLength(4);
  });

  it('lays out two columns and widens sparklines to 80px when the tile is wide', async () => {
    AVAILABLE = [...DEFAULTS];
    HISTORY = {
      BatteryLevel: points(1, 2, 3, 4),
      VehicleSpeed: points(4, 3, 2, 1),
      OutsideTemp: points(1, 2),
      InsideTemp: points(2, 3),
      Odometer: points(3, 4),
      PackCurrent: points(5, 6),
    };
    wire();
    const { container } = renderWidget(FULL, 1);

    const spark = await screen.findByRole('img', { name: 'Battery Level trend' });
    expect(container.querySelector('.grid-cols-2')).toBeTruthy();
    expect(spark.getAttribute('width')).toBe('80');
  });
});

describe('LiveSignalSparklinesWidget — narrow view', () => {
  it('uses a single column and 56px sparklines', async () => {
    AVAILABLE = ['BatteryLevel', 'VehicleSpeed'];
    LIVE = { BatteryLevel: { value: 50, timestamp: 't' } };
    HISTORY = { BatteryLevel: points(1, 2, 3), VehicleSpeed: points(3, 2, 1) };
    wire();
    const { container } = renderWidget(NARROW, 1);

    const spark = await screen.findByRole('img', { name: 'Battery Level trend' });
    expect(container.querySelector('.grid-cols-2')).toBeNull();
    expect(spark.getAttribute('width')).toBe('56');
  });
});

describe('LiveSignalSparklinesWidget — configured signals', () => {
  it('renders only configured signals that are actually available', async () => {
    AVAILABLE = ['BatteryLevel', 'VehicleSpeed', 'OutsideTemp'];
    HISTORY = { BatteryLevel: points(1, 2), VehicleSpeed: points(2, 1) };
    wire();
    renderWidget(FULL, 1, { signals: ['BatteryLevel', 'NonExistentSignal', 'VehicleSpeed'] });

    expect(await screen.findByText('Battery Level')).toBeInTheDocument();
    expect(screen.getByText('Vehicle Speed')).toBeInTheDocument();
    // Dropped: the configured signal is not in the available catalogue.
    expect(screen.queryByText('Non Existent Signal')).toBeNull();
    // And an available-but-not-configured signal is not shown either.
    expect(screen.queryByText('Outside Temp')).toBeNull();
  });

  it('keeps the default signals when the available catalogue is empty', async () => {
    AVAILABLE = []; // available.size === 0 → keep raw defaults
    wire();
    renderWidget(FULL, 1);

    expect(await screen.findByText('Battery Level')).toBeInTheDocument();
    expect(screen.getByText('Pack Current')).toBeInTheDocument();
  });
});

describe('LiveSignalSparklinesWidget — empty / lifecycle states', () => {
  it('shows an accessible empty state when no signals resolve', async () => {
    AVAILABLE = [];
    wire();
    renderWidget(FULL, 1, { signals: [] }); // explicit empty config + empty catalogue

    expect(await screen.findByText('No signals available')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Battery Level')).toBeNull();
  });

  it('renders only a skeleton (no title / rows) while the catalogue is loading', () => {
    mockedRequest.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = renderWidget(FULL, 1);

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Live Signal Sparklines')).toBeNull();
    expect(screen.queryByText('Battery Level')).toBeNull();
  });

  it('disables every query and never touches the network without a vehicle', () => {
    MOCK_VEHICLES = { data: [] }; // no vehicleId + empty fleet → id 0 → disabled
    wire();
    renderWidget(FULL);

    expect(mockedRequest).not.toHaveBeenCalled();
    // Default rows still render as inert placeholders.
    expect(screen.getByText('Battery Level')).toBeInTheDocument();
    expect(screen.getAllByText('no data').length).toBeGreaterThan(0);
  });

  it('degrades to dashed values (no crash) when the live query fails', async () => {
    AVAILABLE = ['BatteryLevel', 'VehicleSpeed'];
    HISTORY = { BatteryLevel: points(1, 2, 3), VehicleSpeed: points(3, 2, 1) };
    mockedRequest.mockImplementation((url: string) => {
      if (url.endsWith('/available')) return Promise.resolve({ signals: AVAILABLE });
      if (url.endsWith('/live')) return Promise.reject(new Error('live down'));
      const m = url.match(/^\/signals\/\d+\/([^/]+)\/history/);
      if (m) return Promise.resolve({ data: HISTORY[decodeURIComponent(m[1])] ?? [] });
      return Promise.resolve({});
    });
    renderWidget(FULL, 1);

    // Rows still render from the catalogue + history; live values dash out.
    expect(await screen.findByText('Battery Level')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Battery Level trend' })).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('LiveSignalSparklinesWidget — vehicle resolution', () => {
  it('falls back to the first fleet vehicle when no vehicleId prop is given', async () => {
    MOCK_VEHICLES = fleet(7);
    AVAILABLE = ['BatteryLevel'];
    LIVE = { BatteryLevel: { value: 40, timestamp: 't' } };
    HISTORY = { BatteryLevel: points(1, 2, 3) };
    wire();
    renderWidget(FULL); // no explicit vehicleId → resolves to fleet[0].id === 7

    await waitFor(() => expect(calledWithUrl('/signals/7/available')).toBe(true));
    expect(calledWithUrl('/signals/7/live')).toBe(true);
    expect(await screen.findByText('Battery Level')).toBeInTheDocument();
  });
});

describe('LiveSignalSparklinesWidget — refresh', () => {
  it('refetches the live snapshot when the accessible "Refresh" control is activated', async () => {
    AVAILABLE = ['BatteryLevel'];
    LIVE = { BatteryLevel: { value: 60, timestamp: 't' } };
    HISTORY = { BatteryLevel: points(1, 2, 3) };
    wire();
    renderWidget(FULL, 1);

    // Wait for the first load to settle — a visible value implies /live is no
    // longer fetching, so the refresh control is armed.
    expect(await screen.findByText(fmtNumber(60, 1))).toBeInTheDocument();
    await waitFor(() => expect(liveCallCount()).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    await waitFor(() => expect(liveCallCount()).toBe(2));
  });
});
