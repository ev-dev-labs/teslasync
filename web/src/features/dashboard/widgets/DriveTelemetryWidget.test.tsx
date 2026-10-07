/**
 * DriveTelemetryWidget — behaviour + hardening tests.
 *
 * DriveTelemetryWidget is a dashboard tile that resolves a target vehicle
 * (`vehicleId` prop → first vehicle from `useVehicles` → 0), fetches that
 * vehicle's drives (`useDrives`), picks the most recent one by `startTs`, and
 * streams its per-point telemetry (`useDriveTelemetry`). Inside `WidgetShell`
 * it renders one of two layouts:
 *   - compact  (cols ≤ 1) → a `WidgetChartSummary` stat strip (Distance /
 *                           Duration / Efficiency), no chart, no legend.
 *   - standard (cols > 1) → a header stat strip, a Recharts ComposedChart
 *                           (speed line, power area, battery dashed line, and
 *                           — only when wide, cols ≥ 3 — an elevation area and
 *                           a start-address badge), and a custom legend.
 * The body is never a blank panel: an explicit `EmptyState` stands in for "no
 * drives" and, separately, for "no telemetry on this drive".
 *
 * The two data hooks are mocked at their `@/api/hooks/*` boundaries so every
 * orchestration branch is deterministic and the network is never touched.
 * `useUnits` is stubbed so the km / mi distance branch can be flipped per-test
 * while the *real* SI converters (`convertDistanceFromSI`) still run.
 * `useThemeChartPalette` is stubbed (no ThemeProvider needed) and Recharts'
 * `ResponsiveContainer` is given a concrete size so the ComposedChart actually
 * paints (jsdom reports 0×0). `react-i18next` is echo-mocked (returns the
 * English fallback, interpolating `{{var}}`); `useSettings` / `useTimezone`
 * come from the global stub in src/test-setup.ts (metric — km).
 *
 * Facets covered:
 *   - vehicle resolution + hook wiring: prop wins → first vehicle → undefined;
 *     telemetry is fetched for the newest drive by startTs; "" when no drives.
 *   - shell states: loading skeleton, telemetry-error QueryError, and — the
 *     hardening — a *drives*-fetch error now surfaces a QueryError instead of a
 *     misleading "No recent drives" empty state; explicit empty states for both
 *     "no drives" and "no telemetry"; never a blank panel.
 *   - standard layout: distance / duration / efficiency stats, the custom
 *     legend, and the wide-only elevation series + start-address badge.
 *   - imperial units: distance converts to miles and efficiency is labelled
 *     Wh/mi (the SI → display boundary).
 *   - chart render: a populated drive paints a `.recharts-surface`; an empty
 *     drive shows the "no telemetry" empty state (no surface).
 *   - compact layout: the stat summary without a chart / legend / title.
 *   - null-safety / hardening: efficiency omitted when energy or distance is
 *     absent; null distance/duration render "0.0" / "0" (the `?? 0` guards);
 *     an all-null telemetry point still builds a chart without throwing.
 *   - refresh wiring: the freshness control retries BOTH queries (the fix — the
 *     old handler only refetched the telemetry query, which is disabled while
 *     the drives query is the one that failed).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// i18n echo mock: returns the fallback string (or key when none), interpolating
// {{var}} tokens from the options object so assertions target rendered English.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fb?: unknown, opts?: unknown) => {
      const options = (opts && typeof opts === 'object' ? opts : undefined) as
        | Record<string, unknown>
        | undefined;
      let base = typeof fb === 'string' ? fb : key;
      if (options) {
        base = base.replace(/{{\s*(\w+)\s*}}/g, (_m, n: string) =>
          n in options && options[n] != null ? String(options[n]) : `{{${n}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: unknown }) => <>{children as never}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// Both data hooks are mocked so the widget's orchestration is deterministic.
vi.mock('@/api/hooks/useDriving', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useDriving')>();
  return { ...actual, useDrives: vi.fn(), useDriveTelemetry: vi.fn() };
});

vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return { ...actual, useVehicles: vi.fn() };
});

// useUnits stub — lets each test flip the display distance/speed unit (km / mi).
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));

// Charts: stub the theme palette (so no ThemeProvider is needed) and hand the
// ComposedChart a concrete size (jsdom reports 0×0) so it actually paints and
// the chart-data transform / legend paths are exercised.
vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    ...actual,
    ...chartTestDoubles,
    useThemeChartPalette: () => ({
      primary: '#00b4d8',
      accent: '#e63946',
      series: ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#3b82f6'],
      positive: '#22c55e',
      negative: '#ef4444',
      warning: '#f59e0b',
      neutral: '#94a3b8',
    }),
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 320, height: 160 }),
  };
});

// jsdom lacks matchMedia; useMotionPreference (via <DataFreshness>) reads it.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

import DriveTelemetryWidget from './DriveTelemetryWidget';
import { useDrives, useDriveTelemetry } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import type { Drive, DriveTelemetryPoint } from '@/types/driving';
import type { WidgetProps, WidgetSize } from './types';

const mockVehicles = vi.mocked(useVehicles);
const mockDrives = vi.mocked(useDrives);
const mockTelemetry = vi.mocked(useDriveTelemetry);
const mockUnits = vi.mocked(useUnits);

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): never {
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
  } as never;
}

/** `useVehicles()` stub — the widget only reads `.data[0].id`. */
function vehicles(ids: number[]): never {
  return { data: ids.map((id) => ({ id })) } as never;
}

/** `useUnits()` stub — the widget reads `unitPrefs.distance` and `.speed`. */
function units(distance: 'km' | 'mi'): never {
  return { unitPrefs: { distance, speed: distance === 'mi' ? 'mph' : 'km/h' } } as never;
}

/**
 * Fully-populated Drive with clean, deterministic display values:
 *   distanceM 100000 → 100 km (or 62.1 mi)
 *   durationS 1800   → 30 min
 *   energyUsedWh 15000 / 100 km → 150 Wh/km (or 241 Wh/mi)
 */
function makeDrive(over: Partial<Drive> = {}): Drive {
  return {
    id: 100,
    vehicleId: 1,
    startTs: '2025-01-01T10:00:00Z',
    endTs: '2025-01-01T10:30:00Z',
    durationS: 1800,
    distanceM: 100_000,
    startAddress: '123 Main St',
    endAddress: '456 Oak Ave',
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 60,
    energyUsedWh: 15_000,
    regenEnergyWh: 2_000,
    avgSpeedMps: null,
    maxSpeedMps: null,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '2025-01-01T10:30:00Z',
    updatedAt: '2025-01-01T10:30:00Z',
    ...over,
  };
}

/** A single telemetry point; speed is SI m/s (20 m/s → 72 km/h). */
function makePoint(over: Partial<DriveTelemetryPoint> = {}): DriveTelemetryPoint {
  return {
    timestamp: '2025-01-01T10:05:00Z',
    speed: 20,
    power: 30,
    batteryLevel: 78,
    outsideTemp: null,
    insideTemp: null,
    driverTemp: null,
    passengerTemp: null,
    elevation: 120,
    idealRange: null,
    ratedRange: null,
    estRange: null,
    odometer: null,
    soc: 78,
    usableSoc: null,
    tirePressureFl: null,
    tirePressureFr: null,
    tirePressureRl: null,
    tirePressureRr: null,
    isClimateOn: null,
    fanStatus: null,
    latitude: null,
    longitude: null,
    ...over,
  };
}

const COMPACT: WidgetSize = { cols: 1, rows: 2 };
const STANDARD: WidgetSize = { cols: 2, rows: 3 };
const WIDE: WidgetSize = { cols: 3, rows: 3 };

function renderWidget(size: WidgetSize, props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DriveTelemetryWidget size={size} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockVehicles.mockReturnValue(vehicles([1]));
  mockUnits.mockReturnValue(units('km'));
  mockDrives.mockReturnValue(qr({ data: [makeDrive()] }));
  mockTelemetry.mockReturnValue(qr({ data: [makePoint()] }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DriveTelemetryWidget — vehicle resolution & hook wiring', () => {
  it('prefers the explicit vehicleId prop over the vehicle list', () => {
    mockVehicles.mockReturnValue(vehicles([7, 9]));
    renderWidget(STANDARD, { vehicleId: 42 });

    expect(mockDrives).toHaveBeenCalledWith('42');
  });

  it('falls back to the first vehicle id when no vehicleId prop is given', () => {
    mockVehicles.mockReturnValue(vehicles([7, 9]));
    renderWidget(STANDARD);

    expect(mockDrives).toHaveBeenCalledWith('7');
  });

  it('passes undefined (disabling the query) when there is neither a prop nor a vehicle', () => {
    mockVehicles.mockReturnValue(vehicles([]));
    renderWidget(STANDARD);

    expect(mockDrives).toHaveBeenCalledWith(undefined);
  });

  it('fetches telemetry for the most recent drive by startTs', () => {
    const older = makeDrive({ id: 100, startTs: '2025-01-01T08:00:00Z' });
    const newer = makeDrive({ id: 200, startTs: '2025-01-02T09:00:00Z' });
    mockDrives.mockReturnValue(qr({ data: [older, newer] }));
    renderWidget(STANDARD);

    expect(mockTelemetry).toHaveBeenCalledWith('200');
  });

  it('requests no telemetry (empty id) when there are no drives', () => {
    mockDrives.mockReturnValue(qr({ data: [] }));
    renderWidget(STANDARD);

    expect(mockTelemetry).toHaveBeenCalledWith('');
  });
});

describe('DriveTelemetryWidget — shell states', () => {
  it('shows a skeleton (never a blank panel) while the drives query loads', () => {
    mockDrives.mockReturnValue(qr({ isLoading: true, isFetching: true, data: undefined }));
    const { container } = renderWidget(STANDARD);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Drive Telemetry')).toBeNull();
    expect(screen.queryByText('No recent drives')).toBeNull();
  });

  it('shows a skeleton while the telemetry query loads', () => {
    mockTelemetry.mockReturnValue(qr({ isLoading: true, isFetching: true, data: undefined }));
    const { container } = renderWidget(STANDARD);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('renders a QueryError (not an empty state) when the telemetry fetch fails', () => {
    mockTelemetry.mockReturnValue(
      qr({ isError: true, error: new Error('telemetry down'), data: undefined }),
    );
    renderWidget(STANDARD);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No telemetry for this drive')).toBeNull();
    expect(screen.queryByText('No recent drives')).toBeNull();
  });

  it('surfaces a drives-fetch error as a QueryError instead of a misleading empty state', () => {
    // Regression guard for the hardening: the `/drives` error used to be
    // swallowed and rendered as "No recent drives" (an outage looked like "no
    // data"). It must now drive the shell's QueryError.
    mockDrives.mockReturnValue(
      qr({ isError: true, error: new Error('drives down'), data: undefined }),
    );
    renderWidget(STANDARD);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No recent drives')).toBeNull();
  });

  it('renders an explicit empty state when there are no drives', () => {
    mockDrives.mockReturnValue(qr({ data: [] }));
    renderWidget(STANDARD);

    expect(screen.getByText('No recent drives')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the stats plus a "no telemetry" empty state when the drive has no points', () => {
    mockTelemetry.mockReturnValue(qr({ data: [] }));
    const { container } = renderWidget(STANDARD);

    expect(screen.getByText('No telemetry for this drive')).toBeInTheDocument();
    expect(screen.getByText('Distance')).toBeInTheDocument();
    // No chart surface when there are no points — only the empty state.
    expect(container.querySelector('.recharts-surface')).toBeNull();
    expect(screen.queryByText('No recent drives')).toBeNull();
  });
});

describe('DriveTelemetryWidget — standard layout (metric)', () => {
  it('renders distance, duration and efficiency stats with metric units', () => {
    // Empty telemetry keeps the chart (and its numeric axis ticks) out of the
    // DOM so the stat values below are unambiguous.
    mockTelemetry.mockReturnValue(qr({ data: [] }));
    renderWidget(STANDARD);

    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('100.0')).toBeInTheDocument(); // 100000 m → 100.0 km
    expect(screen.getByText('km')).toBeInTheDocument();

    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument(); // 1800 s → 30 min
    expect(screen.getByText('min')).toBeInTheDocument();

    expect(screen.getByText('Efficiency')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument(); // 15000 Wh / 100 km
    expect(screen.getByText('Wh/km')).toBeInTheDocument();
  });

  it('renders the shared persisted legend for populated telemetry', () => {
    mockTelemetry.mockReturnValue(qr({ data: [makePoint()] }));
    renderWidget(STANDARD);

    expect(screen.getByTestId('embedded-chart')).toHaveAttribute(
      'data-chart-key',
      'dashboard-drive-telemetry',
    );
    // cols=2 is not "wide" (≥3): no address badge.
    expect(screen.queryByText('123 Main St')).toBeNull();
  });

  it('paints the telemetry chart surface once points exist', () => {
    mockTelemetry.mockReturnValue(qr({ data: [makePoint(), makePoint({ timestamp: '2025-01-01T10:06:00Z' })] }));
    const { container } = renderWidget(STANDARD);

    expect(container.querySelector('.recharts-surface')).not.toBeNull();
    expect(screen.queryByText('No telemetry for this drive')).toBeNull();
  });
});

describe('DriveTelemetryWidget — wide layout', () => {
  it('adds the start-address badge and keeps the shared legend in wide mode', () => {
    mockTelemetry.mockReturnValue(qr({ data: [makePoint()] }));
    renderWidget(WIDE);

    expect(screen.getByText('123 Main St')).toBeInTheDocument();
    expect(screen.getByTestId('embedded-chart')).toHaveAttribute(
      'data-chart-key',
      'dashboard-drive-telemetry',
    );
  });

  it('renders the chart, exercising both value and null speed points without crashing', () => {
    mockTelemetry.mockReturnValue(
      qr({
        data: [
          makePoint({ speed: 20 }),
          makePoint({ speed: null, timestamp: '2025-01-01T10:07:00Z' }),
        ],
      }),
    );
    const { container } = renderWidget(WIDE);

    expect(container.querySelector('.recharts-surface')).not.toBeNull();
    expect(screen.getByTestId('embedded-chart')).toHaveAttribute(
      'data-chart-key',
      'dashboard-drive-telemetry',
    );
    expect(screen.queryByText('No telemetry for this drive')).toBeNull();
  });
});

describe('DriveTelemetryWidget — imperial units', () => {
  it('converts distance to miles and labels efficiency Wh/mi', () => {
    mockUnits.mockReturnValue(units('mi'));
    mockTelemetry.mockReturnValue(qr({ data: [] }));
    renderWidget(STANDARD);

    expect(screen.getByText('62.1')).toBeInTheDocument(); // 100000 m ÷ 1609.344
    expect(screen.getByText('mi')).toBeInTheDocument();
    expect(screen.getByText('241')).toBeInTheDocument(); // 15000 Wh ÷ 62.137 mi
    expect(screen.getByText('Wh/mi')).toBeInTheDocument();
    expect(screen.queryByText('Wh/km')).toBeNull();
  });
});

describe('DriveTelemetryWidget — compact layout', () => {
  it('renders the stat summary without a chart, legend, or title', () => {
    renderWidget(COMPACT);

    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('100.0')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    // Compact tiles suppress the shell title, the chart, and the legend.
    expect(screen.queryByText('Drive Telemetry')).toBeNull();
    expect(screen.queryByTestId('chart-legend')).toBeNull();
  });

  it('shows the empty state (compact) when there are no drives', () => {
    mockDrives.mockReturnValue(qr({ data: [] }));
    renderWidget(COMPACT);

    expect(screen.getByText('No recent drives')).toBeInTheDocument();
    expect(screen.queryByText('Distance')).toBeNull();
  });

  it('shows a skeleton while loading (compact)', () => {
    mockDrives.mockReturnValue(qr({ isLoading: true, data: undefined }));
    const { container } = renderWidget(COMPACT);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });
});

describe('DriveTelemetryWidget — null-safety & hardening', () => {
  it('omits the efficiency stat when energy used is unavailable', () => {
    mockDrives.mockReturnValue(qr({ data: [makeDrive({ energyUsedWh: null })] }));
    mockTelemetry.mockReturnValue(qr({ data: [] }));
    renderWidget(STANDARD);

    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.queryByText('Efficiency')).toBeNull();
    expect(screen.queryByText('Wh/km')).toBeNull();
  });

  it('omits the efficiency stat when the drive distance is zero (no divide-by-zero)', () => {
    mockDrives.mockReturnValue(qr({ data: [makeDrive({ distanceM: 0, energyUsedWh: 15_000 })] }));
    mockTelemetry.mockReturnValue(qr({ data: [] }));
    renderWidget(STANDARD);

    expect(screen.queryByText('Efficiency')).toBeNull();
    expect(screen.getByText('0.0')).toBeInTheDocument(); // distance renders 0.0, not NaN
  });

  it('renders zeroed stats (not NaN) when distance and duration are null', () => {
    mockDrives.mockReturnValue(
      qr({
        data: [
          makeDrive({
            distanceM: null as unknown as number,
            durationS: null as unknown as number,
            energyUsedWh: null,
          }),
        ],
      }),
    );
    mockTelemetry.mockReturnValue(qr({ data: [] }));
    renderWidget(STANDARD);

    // Without the `?? 0` guards these would be NaN → "NaN"/"—" style output.
    expect(screen.getByText('0.0')).toBeInTheDocument(); // distance
    expect(screen.getByText('0')).toBeInTheDocument(); // duration
  });

  it('builds the chart without throwing when a telemetry point is entirely null', () => {
    mockTelemetry.mockReturnValue(
      qr({
        data: [
          makePoint({ speed: null, power: null, batteryLevel: null, soc: null, elevation: null }),
        ],
      }),
    );
    const { container } = renderWidget(WIDE);

    expect(container.querySelector('.recharts-surface')).not.toBeNull();
    expect(screen.getByTestId('embedded-chart')).toHaveAttribute(
      'data-chart-key',
      'dashboard-drive-telemetry',
    );
  });
});

describe('DriveTelemetryWidget — refresh wiring', () => {
  it('retries BOTH the drives and telemetry queries when refresh is activated', () => {
    const refetchDrives = vi.fn();
    const refetchTelemetry = vi.fn();
    mockDrives.mockReturnValue(qr({ data: [makeDrive()], refetch: refetchDrives }));
    mockTelemetry.mockReturnValue(qr({ data: [makePoint()], refetch: refetchTelemetry }));
    renderWidget(STANDARD);

    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));

    expect(refetchDrives).toHaveBeenCalledTimes(1);
    expect(refetchTelemetry).toHaveBeenCalledTimes(1);
  });
});
