/**
 * EfficiencyPage contract tests.
 *
 * EfficiencyPage turns two TanStack Query hooks — `useDrivingStats` (lifetime
 * aggregates) and `useDrives` (per-drive rows) — into a KPI band, an overview
 * gauge + daily-trend chart, speed/temperature scatter clouds and a
 * temperature-bucketed efficiency table. The page owns two subtle unit
 * contracts that these tests pin down:
 *
 *   • `useDrivingStats` returns LEGACY DISPLAY SCALARS — `totalDistanceKm` in
 *     km, `avgSpeedKmh`/`topSpeedKmh` in km/h, `avgEfficiencyWhKm` in Wh/km —
 *     NOT SI. The page must bridge km→m and km/h→m/s before handing them to
 *     the SI converters, otherwise every stat is inflated ~1000×/~3.6×. This
 *     was the bug this elevation fixes; the km-vs-mi tests below lock it.
 *   • `useDrives` rows ARE SI (`distanceM` m, `avgSpeedMps` m/s,
 *     `outsideTempAvgC` °C). The temperature-bucket table accumulates SI and
 *     converts exactly once at render — the previous code double-converted,
 *     collapsing "200 km" to "0" and "72 km/h" to "259".
 *
 * The two pure helpers (`efficiencyColor`, `getEfficiency`) are exercised
 * directly. The page is driven through mocked hooks (the DriveDetailPage
 * convention) so every branch — loading, error, empty, km, mi, populated —
 * is reachable deterministically. react-i18next is stubbed for English
 * fallbacks (the TimelinePage/FleetComparePage convention); `useSettings`
 * comes from the global stub in src/test-setup.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Drive, DrivingStats } from '@/types/driving';

/* ── react-i18next: deterministic English-fallback rendering ─────────────── */
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined;
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined);
        const interpolate = (s: string) =>
          opts
            ? Object.keys(opts).reduce(
                (acc, k) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(opts[k])),
                s,
              )
            : s;
        if (opts && typeof opts.defaultValue === 'string') return interpolate(opts.defaultValue);
        if (fallback != null) return interpolate(fallback);
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

/* ── Hoisted mutable state shared with the hook mocks ─────────────────────── */
const H = vi.hoisted(() => ({
  units: { current: null as unknown as ReturnType<typeof kmUnits> },
  driving: { current: null as unknown as { stats: FakeQuery<DrivingStats>; drives: FakeQuery<Drive[]> } },
  vehicle: { current: { vehicleId: 1 as number | null } },
}));

vi.mock('@/hooks/useUnits', () => ({ useUnits: () => H.units.current }));

vi.mock('@/api/hooks/useDriving', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useDriving')>();
  return {
    ...actual,
    useDrivingStats: () => H.driving.current.stats,
    useDrives: () => H.driving.current.drives,
  };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: H.vehicle.current.vehicleId,
    vehicle: null,
    vehicles: [],
    setVehicleId: vi.fn(),
  }),
}));

// Safety net: any peripheral component (chart annotations, freshness) that
// reaches the API client resolves to an empty payload — never a real fetch.
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, request: vi.fn().mockResolvedValue([]) };
});

// Stub the header action controls: they own their own store/query wiring which
// is out of scope here. RangePicker still exposes its onChange so the date
// filter can be driven through the page's real useUrlBatch → useUrlString path.
vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
  RangePicker: ({
    onChange,
    triggerTestId,
  }: {
    onChange: (r: { start: string; end: string }) => void;
    triggerTestId?: string;
  }) => (
    <button
      type="button"
      data-testid={triggerTestId}
      onClick={() => onChange({ start: '2000-01-01', end: '2000-01-02' })}
    >
      range
    </button>
  ),
}));

// Keep MetricCard / MetricBar real (their formatted output is asserted); only
// SavedViewMenu is stubbed away from its router/query dependencies.
vi.mock('@/components/data-display', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/data-display')>();
  return { ...actual, SavedViewMenu: () => <div data-testid="saved-view-menu" /> };
});

import EfficiencyPage, { efficiencyColor, getEfficiency } from './EfficiencyPage';
import { ToastProvider } from '@/components/feedback/Toast';
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat';

/* ── Fixtures ─────────────────────────────────────────────────────────────── */
interface FakeQuery<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function makeQuery<T>(over: Partial<FakeQuery<T>> = {}): FakeQuery<T> {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function makeStats(over: Partial<DrivingStats> = {}): DrivingStats {
  return {
    totalDrives: 42,
    totalDistanceKm: 5000,
    totalDurationS: 360000,
    avgEfficiencyWhKm: 200,
    avgSpeedKmh: 60,
    topSpeedKmh: 120,
    regenRatio: 0.5,
    regenEnergyWh: 12000,
    co2SavedKg: 300,
    ...over,
  };
}

// A drive within the default (last-30-days) window with 10% battery burned
// over 50 km at 20 m/s → getEfficiency = (10 * 0.75 * 1000) / 50 = 150 Wh/km.
function makeDrive(over: Partial<Drive> = {}): Drive {
  const now = new Date().toISOString();
  return {
    id: 1,
    vehicleId: 1,
    startTs: now,
    endTs: now,
    durationS: 3600,
    distanceM: 50000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 60,
    endBatteryPct: 50,
    energyUsedWh: 7500,
    regenEnergyWh: 500,
    avgSpeedMps: 20,
    maxSpeedMps: 30,
    avgPowerW: 12000,
    outsideTempAvgC: 25,
    insideTempAvgC: 21,
    score: 90,
    endedStatus: 'parked',
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function kmUnits() {
  return {
    unitPrefs: {
      distance: 'km',
      speed: 'km/h',
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
      precision: 2,
    },
    formatDuration: (s: number | null | undefined, o?: { precision?: number }) =>
      `${(Number(s ?? 0) / 3600).toFixed(o?.precision ?? 1)} h`,
    formatEnergy: (wh: number | null | undefined, o?: { precision?: number }) =>
      `${(Number(wh ?? 0) / 1000).toFixed(o?.precision ?? 1)} kWh`,
  };
}

function miUnits() {
  const base = kmUnits();
  return {
    ...base,
    unitPrefs: { ...base.unitPrefs, distance: 'mi', speed: 'mph', temperature: '°F' },
  };
}

function setDriving(
  statsOver: Partial<FakeQuery<DrivingStats>>,
  drivesOver: Partial<FakeQuery<Drive[]>>,
) {
  H.driving.current = {
    stats: makeQuery<DrivingStats>(statsOver),
    drives: makeQuery<Drive[]>(drivesOver),
  };
}

function renderPage(path = '/efficiency') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <EfficiencyPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
  H.units.current = kmUnits();
  H.vehicle.current = { vehicleId: 1 };
  setDriving({ data: makeStats() }, { data: [] });
});

/* ── efficiencyColor: the 5-stop ramp + its exact boundaries ─────────────── */
describe('efficiencyColor', () => {
  it('maps Wh/km to the correct colour stop at every threshold boundary', () => {
    expect(efficiencyColor(100)).toBe('#39ff14');
    expect(efficiencyColor(139.9)).toBe('#39ff14');
    // Boundaries are inclusive on the lower edge of the NEXT stop.
    expect(efficiencyColor(140)).toBe('#10b981');
    expect(efficiencyColor(169)).toBe('#10b981');
    expect(efficiencyColor(170)).toBe('#00f0ff');
    expect(efficiencyColor(199)).toBe('#00f0ff');
    expect(efficiencyColor(200)).toBe('#f59e0b');
    expect(efficiencyColor(239)).toBe('#f59e0b');
    expect(efficiencyColor(240)).toBe('#ef4444');
    expect(efficiencyColor(999)).toBe('#ef4444');
  });
});

/* ── getEfficiency: battery-delta → Wh/km, or null for degenerate drives ─── */
describe('getEfficiency', () => {
  it('derives Wh/km from battery delta and distance', () => {
    // (60 - 50)% * 0.75 * 1000 / (50000 / 1000) = 7500 / 50 = 150.
    expect(getEfficiency(makeDrive())).toBe(150);
    // Doubling the distance halves the derived consumption.
    expect(getEfficiency(makeDrive({ distanceM: 100000 }))).toBe(75);
  });

  it('returns null when the drive cannot yield a meaningful figure', () => {
    expect(getEfficiency(makeDrive({ distanceM: 0 }))).toBeNull();
    // No net battery used (start <= end) → not derivable.
    expect(getEfficiency(makeDrive({ startBatteryPct: 50, endBatteryPct: 60 }))).toBeNull();
    // Missing battery readings collapse to a zero delta → null.
    expect(
      getEfficiency(makeDrive({ startBatteryPct: null, endBatteryPct: null })),
    ).toBeNull();
  });
});

/* ── EfficiencyPage: page-level states + the unit contracts ──────────────── */
describe('EfficiencyPage', () => {
  it('shows the loading skeletons (never the empty state or metrics) while stats load', () => {
    setDriving({ isLoading: true }, { isLoading: true });
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Efficiency' })).toBeInTheDocument();
    // Loading takes precedence over both the empty state and the metric cards.
    expect(screen.queryByText('No efficiency data available yet')).toBeNull();
    expect(screen.queryByText('Avg Consumption')).toBeNull();
  });

  it('surfaces a failure banner and still renders the empty KPI placeholder', () => {
    setDriving({ isError: true, error: new Error('stats blew up') }, { data: [] });
    renderPage();

    expect(screen.getByText(/Failed to load data/)).toBeInTheDocument();
    expect(screen.getByText(/stats blew up/)).toBeInTheDocument();
    // Sections never disappear — the KPI band degrades to a placeholder.
    expect(screen.getByText('No efficiency data available yet')).toBeInTheDocument();
  });

  it('renders an empty-state placeholder (never a blank panel) when there are no stats', () => {
    setDriving({ data: undefined }, { data: [] });
    renderPage();

    expect(screen.getByText('No efficiency data available yet')).toBeInTheDocument();
    // A benign empty result is not an error.
    expect(screen.queryByText(/Failed to load data/)).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Efficiency' })).toBeInTheDocument();
  });

  it('renders km stats without the legacy SI-converter inflation bug', () => {
    renderPage();

    // avgSpeedKmh=60 must display as 60.00 km/h — the pre-fix code fed km/h
    // straight into convertSpeedFromSI (an m/s converter) → 216.00.
    expect(screen.getByText('60.00')).toBeInTheDocument();
    expect(screen.queryByText('216.00')).toBeNull();
    // topSpeedKmh=120 → 120 (pre-fix: 432); totalDistanceKm=5000 → 5,000
    // (pre-fix: 5 because km was treated as metres).
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.queryByText('432')).toBeNull();
    expect(screen.getByText('5,000')).toBeInTheDocument();
    // Efficiency (5.0 km/kWh), CO₂ (300 kg) and drive count (42) round-trip.
    expect(screen.getByText('5.0')).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('re-derives every stat for an imperial (mi / mph) preference', () => {
    H.units.current = miUnits();
    renderPage();

    // 60 km/h → 37.28 mph, 5000 km → 3,107 mi, 200 Wh/km → 321.87 Wh/mi.
    expect(screen.getByText('37.28')).toBeInTheDocument();
    expect(screen.getByText('3,107')).toBeInTheDocument();
    expect(screen.getByText('321.87')).toBeInTheDocument();
    expect(screen.getAllByText('Wh/mi').length).toBeGreaterThan(0);
    // The km figures must NOT leak through under the imperial preference.
    expect(screen.queryByText('60.00')).toBeNull();
    expect(screen.queryByText('5,000')).toBeNull();
  });

  it('converts the temperature-bucket table SI values exactly once', () => {
    setDriving({ data: makeStats() }, { data: [makeDrive(), makeDrive(), makeDrive(), makeDrive()] });
    renderPage();

    const row = screen.getByText('20–30°C').closest('tr');
    expect(row).not.toBeNull();
    const cells = within(row as HTMLElement);
    // 4 × 50 km = 200 km total (pre-fix double-conversion collapsed this to 0).
    expect(cells.getByText('200')).toBeInTheDocument();
    // 20 m/s → 72 km/h avg (pre-fix double-conversion inflated this to 259).
    expect(cells.getByText('72 km/h')).toBeInTheDocument();
    // Avg consumption for the bucket is the raw 150 Wh/km.
    expect(cells.getByText('150')).toBeInTheDocument();
    expect(cells.queryByText('259 km/h')).toBeNull();
  });

  it('exposes accessible landmark + chart regions once data is present', () => {
    setDriving({ data: makeStats() }, { data: [makeDrive(), makeDrive(), makeDrive(), makeDrive()] });
    renderPage();

    // Each band is a labelled region; the daily-trend chart is an aria-labelled figure.
    expect(screen.getByRole('region', { name: 'Key metrics' })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Daily efficiency trend area chart' }),
    ).toBeInTheDocument();
    // The header still exposes the (stubbed) range control by its test id.
    expect(screen.getByTestId('efficiency-range')).toBeInTheDocument();
  });

  it('re-filters the drive-derived panels when the range control changes', async () => {
    setDriving({ data: makeStats() }, { data: [makeDrive(), makeDrive(), makeDrive(), makeDrive()] });
    renderPage();

    // The temperature-bucket table is populated for the default window.
    expect(screen.getByText('20–30°C')).toBeInTheDocument();

    // Driving RangePicker → a window in the year 2000 drops every recent drive.
    fireEvent.click(screen.getByTestId('efficiency-range'));

    await waitFor(() =>
      expect(
        screen.getByText('Not enough data for temperature breakdown'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText('20–30°C')).toBeNull();
  });
});
