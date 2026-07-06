/**
 * RegenEfficiencyPage — behaviour + hardening coverage.
 *
 * The page default-exports the orchestrator plus three pure helpers that are
 * unit-tested directly:
 *   - `regenColor`        — ratio → threshold color (every band + boundaries).
 *   - `getRegenRatio`     — per-drive recovery ratio. Regression: the old guard
 *                           gated the ratio on `avgPowerW`, an independently
 *                           nullable field, so drives imported without power
 *                           telemetry showed "—" despite valid energy counters.
 *   - `buildMonthlyTrend` — month-bucketed kWh trend. Regression: the old
 *                           `parseFloat(fmtNumber(x, 1))` round-trip truncated
 *                           high-regen months (a thousands separator turned
 *                           "1,234.5" into `1`).
 *
 * Page render coverage: READY (every section, KPI, panel, caption + the
 * avgPowerW bug fix surfaced end-to-end), LOADING (skeletons, no ready values
 * leak), ERROR (regen band + drives band degrade to QueryError with a wired
 * Retry), EMPTY (per-section EmptyState, never a blank panel, KPI band still
 * shows), FILTER (an out-of-range window empties the client-derived sections),
 * and a11y (KPI landmark, chart image label, icon-only help control label).
 *
 * Network is never hit: the data hooks, vehicle picker, unit formatters, form
 * controls, and the chart-annotation read are all stubbed. i18n is stubbed so
 * visible copy is the English fallback with {{placeholder}} interpolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { ToastProvider } from '@/components/feedback/Toast';
import { chartTokens } from '@/lib/tokens';
import type { Drive, RegenEfficiencyData } from '@/types/driving';

// ── Hoisted, per-test controllable state ─────────────────────────────
const h = vi.hoisted(() => ({
  regen: undefined as unknown,
  drives: undefined as unknown,
  vehicleId: 7 as number | null,
}));

const regenRefetch = vi.fn();
const drivesRefetch = vi.fn();

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, arg2?: unknown, arg3?: unknown) => {
        let template = key;
        let options: Record<string, unknown> | undefined;
        if (typeof arg2 === 'string') {
          template = arg2;
          if (arg3 && typeof arg3 === 'object') options = arg3 as Record<string, unknown>;
        } else if (arg2 && typeof arg2 === 'object') {
          options = arg2 as Record<string, unknown>;
          if (typeof options.defaultValue === 'string') template = options.defaultValue;
        }
        if (options) {
          template = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) =>
            options && options[name] != null ? String(options[name]) : '',
          );
        }
        return template;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useDriving', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useDriving')>();
  return {
    ...actual,
    useRegenEfficiency: () => h.regen,
    useDrives: () => h.drives,
  };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: h.vehicleId,
    vehicle: null,
    vehicles: [],
    setVehicleId: vi.fn(),
  }),
}));

// Deterministic formatters — echo the raw SI number so assertions read cleanly
// and don't depend on the real unit-conversion lib (which has its own tests).
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km',
      speed: 'km/h',
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
      precision: undefined,
    },
    formatDistance: (v: number | null | undefined) => String(v ?? 0),
    formatSpeed: (v: number | null | undefined) => String(v ?? 0),
    formatTemperature: (v: number | null | undefined) => String(v ?? 0),
    formatPressure: (v: number | null | undefined) => String(v ?? 0),
    formatEnergy: (v: number | null | undefined) => String(v ?? 0),
    formatDuration: (v: number | null | undefined) => String(v ?? 0),
    formatPower: (v: number | null | undefined) => String(v ?? 0),
  }),
}));

// ChartContainer's `annotations={…}` prop fires a GET for saved annotations.
// Stub the read so the composed-chart section stays network-free.
vi.mock('@/api/hooks/useAnnotations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useAnnotations')>();
  return { ...actual, useChartAnnotationsAsData: () => ({ annotations: [], isLoading: false }) };
});

// RangePicker → a button that commits a fixed far-future range so the client
// date filter empties the derived sections. VehicleSelect → an inert marker.
vi.mock('@/components/forms', () => ({
  RangePicker: ({
    value,
    onChange,
    triggerTestId,
  }: {
    value: { start: string; end: string };
    onChange: (r: { start: string; end: string }) => void;
    triggerTestId?: string;
    align?: string;
  }) => (
    <button
      type="button"
      data-testid={triggerTestId ?? 'range-picker'}
      data-start={value.start}
      data-end={value.end}
      onClick={() => onChange({ start: '2099-01-01', end: '2099-01-31' })}
    >
      change range
    </button>
  ),
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

import RegenEfficiencyPage, {
  regenColor,
  getRegenRatio,
  buildMonthlyTrend,
} from './RegenEfficiencyPage';

// jsdom lacks matchMedia (framer-motion's useReducedMotion via FadeIn).
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// ── Fixtures ─────────────────────────────────────────────────────────
function makeDrive(overrides: Partial<Drive> = {}): Drive {
  return {
    id: 1,
    vehicleId: 7,
    startTs: '2024-01-15T12:00:00Z',
    endTs: '2024-01-15T13:00:00Z',
    durationS: 3600,
    distanceM: 100_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 60,
    energyUsedWh: 8_000,
    regenEnergyWh: 2_000,
    avgSpeedMps: 20,
    maxSpeedMps: 40,
    avgPowerW: 30_000,
    outsideTempAvgC: 20,
    insideTempAvgC: 21,
    score: null,
    endedStatus: 'completed',
    createdAt: '2024-01-15T12:00:00Z',
    updatedAt: '2024-01-15T13:00:00Z',
    live: false,
    ...overrides,
  };
}

const regenData: RegenEfficiencyData = {
  totalRegenWh: 50_000,
  totalDriveWh: 200_000,
  regenRatio: 18,
  monthlyAvgRegen: 7_000,
  freeCharges: 3,
};

// Two months, both with regen > 0. driveB has avgPowerW: null — the row must
// still show a ratio (the removed-guard regression) → 30.00%.
const driveJan = makeDrive({ id: 1, startTs: '2024-01-15T12:00:00Z', regenEnergyWh: 2_000, energyUsedWh: 8_000 });
const driveFeb = makeDrive({
  id: 2,
  startTs: '2024-02-20T12:00:00Z',
  regenEnergyWh: 3_000,
  energyUsedWh: 10_000,
  avgPowerW: null,
});

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function makeQuery(overrides: Partial<QueryStub> = {}): QueryStub {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: regenRefetch,
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/driving/regen']}>
          <RegenEfficiencyPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  h.vehicleId = 7;
  h.regen = makeQuery({ data: regenData, refetch: regenRefetch });
  h.drives = makeQuery({ data: [driveJan, driveFeb], refetch: drivesRefetch });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ── Page render ─────────────────────────────────────────────────── */

describe('RegenEfficiencyPage', () => {
  it('renders every section, KPI card, panel, and the recovered caption when ready', () => {
    renderPage();

    // Page shell.
    expect(
      screen.getByRole('heading', { level: 1, name: /Regenerative Braking/i }),
    ).toBeInTheDocument();

    // KPI landmark + all six metric cards (never hidden).
    const kpis = screen.getByRole('region', { name: 'Regen summary metrics' });
    for (const label of [
      'Total Regen',
      'Recovery Rate',
      'Monthly Avg kW',
      'Free Charges',
      'Lifetime Regen kWh',
      'Lifetime Drive kWh',
    ]) {
      expect(within(kpis).getByText(label)).toBeInTheDocument();
    }
    // Server recovery rate surfaces as a formatted percent.
    expect(within(kpis).getByText('18.00%')).toBeInTheDocument();

    // Panel titles across the page.
    for (const title of ['Energy Recovery', 'Regen Metrics', 'Recent Regen Drives']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    // "Monthly Regen Trend" is both a PanelTitle and the ChartContainer title.
    expect(screen.getAllByText('Monthly Regen Trend').length).toBeGreaterThanOrEqual(1);

    // Recovered caption interpolates energy + free-charge count.
    expect(screen.getByText(/recovered 50000/)).toBeInTheDocument();

    // The Feb drive has avgPowerW: null yet still yields a ratio (30.00%) —
    // the removed-guard regression, proven end-to-end through the table.
    expect(screen.getByText('30.00%')).toBeInTheDocument();
  });

  it('shows skeletons while loading and leaks no ready metric values', () => {
    h.regen = makeQuery({ isLoading: true, isFetching: true, data: undefined, dataUpdatedAt: 0 });
    h.drives = makeQuery({
      isLoading: true,
      isFetching: true,
      data: undefined,
      dataUpdatedAt: 0,
      refetch: drivesRefetch,
    });

    const { container } = renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: /Regenerative Braking/i }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    // No resolved KPI/metric values leak while loading.
    expect(screen.queryByText('Total Regen')).not.toBeInTheDocument();
    expect(screen.queryByText('18.00%')).not.toBeInTheDocument();
  });

  it('degrades the regen band to QueryError and wires Retry to the regen refetch', () => {
    h.regen = makeQuery({ isError: true, error: new Error('boom'), data: undefined, dataUpdatedAt: 0 });

    renderPage();

    // KPI band + Energy Recovery + Regen Metrics each surface the banner.
    expect(screen.getAllByText(/Can't reach server/i).length).toBeGreaterThanOrEqual(3);

    const retry = screen.getAllByRole('button', { name: /^Retry$/i });
    expect(retry.length).toBeGreaterThanOrEqual(3);

    fireEvent.click(retry[0]);
    expect(regenRefetch).toHaveBeenCalledTimes(1);
    expect(drivesRefetch).not.toHaveBeenCalled();
  });

  it('degrades the drives-derived sections to QueryError wired to the drives refetch', () => {
    h.drives = makeQuery({
      isError: true,
      error: new Error('boom'),
      data: undefined,
      dataUpdatedAt: 0,
      refetch: drivesRefetch,
    });

    renderPage();

    // Monthly trend + recent drives degrade; the regen band stays healthy.
    const banners = screen.getAllByText(/Can't reach server/i);
    expect(banners.length).toBe(2);
    expect(screen.getAllByText('Total Regen').length).toBeGreaterThanOrEqual(1);

    const retry = screen.getAllByRole('button', { name: /^Retry$/i });
    fireEvent.click(retry[0]);
    expect(drivesRefetch).toHaveBeenCalledTimes(1);
  });

  it('renders a per-section EmptyState (never a blank panel) with no regen data', () => {
    h.regen = makeQuery({ data: undefined, refetch: regenRefetch });
    h.drives = makeQuery({ data: [], refetch: drivesRefetch });

    renderPage();

    // Energy Recovery + Regen Metrics both show the no-data message.
    expect(
      screen.getAllByText('No regen efficiency data available yet').length,
    ).toBeGreaterThanOrEqual(2);
    // Chart + table have their own empty copy.
    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.getByText('No regen drives in this period yet')).toBeInTheDocument();

    // KPI band still renders its labels (structural completeness).
    expect(screen.getByText('Total Regen')).toBeInTheDocument();
  });

  it('empties the drives-derived sections when an out-of-range window is committed', () => {
    renderPage();

    // Ready first: the Feb drive's ratio row is present.
    expect(screen.getByText('30.00%')).toBeInTheDocument();
    expect(screen.queryByText('No regen drives in this period yet')).not.toBeInTheDocument();

    // Commit a far-future range that excludes both 2024 drives.
    fireEvent.click(screen.getByTestId('regen-efficiency-range'));

    expect(screen.getByText('No regen drives in this period yet')).toBeInTheDocument();
    expect(screen.queryByText('30.00%')).not.toBeInTheDocument();
  });

  it('labels the KPI landmark, the trend chart image, and the icon-only help control', () => {
    renderPage();

    expect(screen.getByRole('region', { name: 'Regen summary metrics' })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /Monthly regen energy and drive count/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /More info about regen metrics/i }),
    ).toBeInTheDocument();
  });
});

/* ── regenColor ──────────────────────────────────────────────────── */

describe('regenColor', () => {
  it('maps each recovery band to its palette color', () => {
    expect(regenColor(30)).toBe(chartTokens.series[1]); // emerald
    expect(regenColor(20)).toBe(chartTokens.series[5]); // cyan
    expect(regenColor(10)).toBe(chartTokens.series[2]); // amber
    expect(regenColor(5)).toBe(chartTokens.series[3]);  // rose
  });

  it('is inclusive at every band boundary', () => {
    expect(regenColor(25)).toBe(chartTokens.series[1]);
    expect(regenColor(15)).toBe(chartTokens.series[5]);
    expect(regenColor(8)).toBe(chartTokens.series[2]);
    expect(regenColor(7.99)).toBe(chartTokens.series[3]);
  });
});

/* ── getRegenRatio ───────────────────────────────────────────────── */

describe('getRegenRatio', () => {
  it('computes regen ÷ energy as a percent for a typical drive', () => {
    expect(getRegenRatio(makeDrive({ regenEnergyWh: 2_000, energyUsedWh: 8_000 }))).toBe(25);
    expect(
      getRegenRatio(makeDrive({ regenEnergyWh: 1_500, energyUsedWh: 9_000 })),
    ).toBeCloseTo(16.6667, 3);
  });

  it('still resolves a ratio when avgPowerW is null (removed-guard regression)', () => {
    // Pre-fix this returned null purely because avgPowerW was absent, even
    // though both energy counters were present and valid.
    expect(
      getRegenRatio(makeDrive({ regenEnergyWh: 3_000, energyUsedWh: 10_000, avgPowerW: null })),
    ).toBe(30);
  });

  it('returns null when either energy input is missing or non-positive', () => {
    expect(getRegenRatio(makeDrive({ regenEnergyWh: null, energyUsedWh: 8_000 }))).toBeNull();
    expect(getRegenRatio(makeDrive({ regenEnergyWh: 2_000, energyUsedWh: null }))).toBeNull();
    expect(getRegenRatio(makeDrive({ regenEnergyWh: 2_000, energyUsedWh: 0 }))).toBeNull();
    expect(getRegenRatio(makeDrive({ regenEnergyWh: 0, energyUsedWh: 8_000 }))).toBeNull();
  });
});

/* ── buildMonthlyTrend ───────────────────────────────────────────── */

describe('buildMonthlyTrend', () => {
  it('returns an empty array for no drives', () => {
    expect(buildMonthlyTrend([])).toEqual([]);
  });

  it('buckets by YYYY-MM, sums regen in kWh, counts drives, and sorts ascending', () => {
    const trend = buildMonthlyTrend([
      makeDrive({ startTs: '2024-02-10T00:00:00Z', regenEnergyWh: 1_000 }),
      makeDrive({ startTs: '2024-01-05T00:00:00Z', regenEnergyWh: 2_000 }),
      makeDrive({ startTs: '2024-01-25T00:00:00Z', regenEnergyWh: 500 }),
    ]);
    expect(trend).toEqual([
      { month: '2024-01', regenKwh: 2.5, drives: 2 },
      { month: '2024-02', regenKwh: 1, drives: 1 },
    ]);
  });

  it('rounds high-regen months numerically (parseFloat/locale regression)', () => {
    // 1,234,500 Wh → 1234.5 kWh. The old parseFloat(fmtNumber(x, 1)) path saw
    // the "1,234.5" thousands separator and truncated it to 1.
    const trend = buildMonthlyTrend([
      makeDrive({ startTs: '2024-03-01T00:00:00Z', regenEnergyWh: 1_234_500 }),
    ]);
    expect(trend[0].regenKwh).toBe(1234.5);
  });

  it('treats null regen as zero but still counts the drive', () => {
    const trend = buildMonthlyTrend([
      makeDrive({ startTs: '2024-04-01T00:00:00Z', regenEnergyWh: null }),
      makeDrive({ startTs: '2024-04-15T00:00:00Z', regenEnergyWh: 1_000 }),
    ]);
    expect(trend).toEqual([{ month: '2024-04', regenKwh: 1, drives: 2 }]);
  });

  it('caps the series at the most recent 12 months', () => {
    const drives = Array.from({ length: 14 }, (_, i) =>
      makeDrive({ startTs: `20${25 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01T00:00:00Z`, regenEnergyWh: 1_000 }),
    );
    const trend = buildMonthlyTrend(drives);
    expect(trend).toHaveLength(12);
    // Oldest two months dropped → the earliest retained is 2025-03.
    expect(trend[0].month).toBe('2025-03');
  });
});
