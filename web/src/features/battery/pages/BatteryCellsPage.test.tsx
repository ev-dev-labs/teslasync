/**
 * BatteryCellsPage — behaviour + hardening coverage.
 *
 * BatteryCellsPage default-exports the page plus two pure helpers
 * (`cellColor`, `buildHistogram`) that are unit-tested directly. Its
 * file-local sub-components (HeatLegend, CellHeatmap, SummaryStat) are
 * exercised transitively through the page render.
 *
 * What is covered:
 *   1. READY   — KPI band, temperature summary, health-recommendation
 *      insights, the cell-details table, and every panel title render
 *      the deterministic SI values (°C identity path).
 *   2. UNITS   — flipping the temperature preference to °F re-converts
 *      the SI temperatures at the render boundary (proves the useUnits +
 *      page-level spread conversion wiring, not a static string).
 *   3. LOADING — every panel shows a skeleton and no ready values leak.
 *   4. ERROR   — the chart/table/insight panels surface QueryError and
 *      the Retry action is wired to the query's refetch (failure +
 *      interaction path).
 *   5. EMPTY   — each section shows its own EmptyState (never a blank
 *      panel) and the min/max-cell KPIs degrade to an em dash.
 *   6. GUARD   — a null selected vehicle renders <NoVehicleSelected>
 *      instead of the data scaffolding.
 *   7. TOGGLE  — the heatmap/bar toggle swaps views and updates its
 *      accessible label (user interaction + a11y).
 *   8. SORT    — clicking a sortable column header re-sorts the table and
 *      updates aria-sort (interaction + a11y).
 *   9. HELPERS — cellColor thresholds + boundaries and buildHistogram
 *      bucketing / edge cases (pure-function branches).
 *
 * Network is never hit: the data hook, unit hook, vehicle picker, and the
 * chart-annotation query are all stubbed. i18n is stubbed so visible copy
 * is the English fallback with {{placeholder}} interpolation applied.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { ToastProvider } from '@/components/feedback/Toast';
import type { BatteryCellData, CellReading } from '@/api/hooks/useAnalytics';

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles };
});

// ── Hoisted, per-test controllable state ─────────────────────────────
// `query` feeds the stubbed useBatteryCells; `temp` feeds useUnits so a
// single test can flip °C→°F; `selected` feeds useSelectedVehicle.
const h = vi.hoisted(() => ({
  query: undefined as unknown,
  temp: '°C' as '°C' | '°F',
  selected: {
    vehicleId: 7 as number | null,
    vehicles: [{ id: 7, display_name: 'Model 3', vin: 'VIN7' }] as Array<{
      id: number;
      display_name: string;
      vin: string;
    }>,
  },
}));

const refetchMock = vi.fn();

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

vi.mock('@/api/hooks/useAnalytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useAnalytics')>();
  return { ...actual, useBatteryCells: () => h.query };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: h.selected.vehicleId,
    vehicle: null,
    vehicles: h.selected.vehicles,
    setVehicleId: vi.fn(),
  }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km',
      speed: 'km/h',
      temperature: h.temp,
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
      precision: undefined,
    },
    // SI (°C) → user preference at the render boundary. Deterministic and
    // network-free so temperature branches are assertable in both units.
    formatTemperature: (v: number | null | undefined, opts?: { precision?: number }) => {
      const c = typeof v === 'number' ? v : 0;
      const p = opts?.precision ?? 0;
      const val = h.temp === '°F' ? c * 1.8 + 32 : c;
      return `${val.toFixed(p)}${h.temp}`;
    },
    formatDistance: (v: number | null | undefined) => String(v ?? 0),
    formatSpeed: (v: number | null | undefined) => String(v ?? 0),
    formatPressure: (v: number | null | undefined) => String(v ?? 0),
    formatEnergy: (v: number | null | undefined) => String(v ?? 0),
    formatDuration: (v: number | null | undefined) => String(v ?? 0),
    formatPower: (v: number | null | undefined) => String(v ?? 0),
  }),
}));

// The spread-trend chart uses <ChartContainer annotations={…}>, which fires
// a GET for saved annotations. Stub that read so the test stays network-free
// while the create/delete mutation hooks (wired to <ToastProvider>) stay real.
vi.mock('@/api/hooks/useAnnotations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useAnnotations')>();
  return { ...actual, useChartAnnotationsAsData: () => ({ annotations: [], isLoading: false }) };
});

import BatteryCellsPage, { cellColor, buildHistogram } from './BatteryCellsPage';

// jsdom lacks matchMedia (framer-motion's useReducedMotion via FadeIn /
// DataFreshness). The chart/observer polyfills already live in test-setup.ts.
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

interface QueryStub {
  data: BatteryCellData | null | undefined;
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
    refetch: refetchMock,
    ...overrides,
  };
}

function makeCells(): CellReading[] {
  return [
    { cell_number: 1, voltage: 3.9, delta_from_avg: 5.0, status: 'normal' },
    { cell_number: 2, voltage: 3.91, delta_from_avg: 15.0, status: 'slight_deviation' },
    { cell_number: 3, voltage: 3.85, delta_from_avg: -45.0, status: 'significant_deviation' },
    { cell_number: 4, voltage: 3.95, delta_from_avg: 55.0, status: 'significant_deviation' },
  ];
}

function makeData(overrides: Partial<BatteryCellData> = {}): BatteryCellData {
  return {
    status: 'ok',
    total_cells: 4,
    avg_voltage: 3.9025,
    min_voltage: 3.85,
    max_voltage: 3.95,
    voltage_spread: 0.1,
    imbalance_mv: 12.5,
    pack_voltage: 398.5,
    avg_temperature: 25,
    min_temperature: 22,
    max_temperature: 30,
    temp_spread: 8,
    cells: makeCells(),
    history: [
      { timestamp: '2024-06-01T12:00:00Z', min_voltage: 3.86, max_voltage: 3.94, avg_voltage: 3.9, imbalance_mv: 8.0 },
      { timestamp: '2024-06-02T12:00:00Z', min_voltage: 3.85, max_voltage: 3.95, avg_voltage: 3.9, imbalance_mv: 12.5 },
    ],
    ...overrides,
  };
}

function makeEmptyData(): BatteryCellData {
  return {
    status: 'no_data',
    total_cells: 0,
    avg_voltage: 0,
    min_voltage: 0,
    max_voltage: 0,
    voltage_spread: 0,
    imbalance_mv: 0,
    pack_voltage: 0,
    avg_temperature: 0,
    min_temperature: 0,
    max_temperature: 0,
    temp_spread: 0,
    cells: [],
    history: [],
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/battery/cells']}>
          <BatteryCellsPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.temp = '°C';
  h.selected.vehicleId = 7;
  h.selected.vehicles = [{ id: 7, display_name: 'Model 3', vin: 'VIN7' }];
  h.query = makeQuery({ data: makeData() });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BatteryCellsPage', () => {
  it('renders the full dashboard with SI (°C) values when data is ready', () => {
    renderPage();

    // Page shell + a11y landmarks.
    expect(screen.getByRole('heading', { name: /Battery Cells/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Summary metrics' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'At a glance' })).toBeInTheDocument();

    // KPI band — space-before-unit strings are unique to the KPI cards.
    expect(screen.getByText('3.9025 V')).toBeInTheDocument(); // avg voltage
    expect(screen.getByText('#3 3.8500 V')).toBeInTheDocument(); // min cell → cell 3
    expect(screen.getByText('#4 3.9500 V')).toBeInTheDocument(); // max cell → cell 4
    expect(screen.getByText('12.5 mV')).toBeInTheDocument(); // imbalance
    expect(screen.getByText('398.5 V')).toBeInTheDocument(); // pack voltage

    // Temperature summary — SI °C identity via the stubbed formatter.
    expect(screen.getByText('25.0°C')).toBeInTheDocument();
    expect(screen.getByText('22.0°C')).toBeInTheDocument();
    expect(screen.getByText('30.0°C')).toBeInTheDocument();
    expect(screen.getAllByText('8.0°C').length).toBeGreaterThanOrEqual(1); // temp spread

    // Health-recommendation insights (imbalance 12.5 → warning, temp
    // spread 8 → critical, 2 significant-deviation cells → critical).
    expect(screen.getByText('Voltage Spread Increasing')).toBeInTheDocument();
    expect(screen.getByText('High Temperature Spread')).toBeInTheDocument();
    expect(screen.getByText('Critical Cells Detected')).toBeInTheDocument();
    expect(screen.getByText(/2 cell\(s\) show significant deviation/)).toBeInTheDocument();

    // Cell-details table — 4-decimal voltage + signed delta + status label.
    expect(screen.getByText('3.8500')).toBeInTheDocument();
    expect(screen.getByText('+5.0')).toBeInTheDocument();
    expect(screen.getByText('-45.0')).toBeInTheDocument();
    expect(screen.getByText('Normal')).toBeInTheDocument();
    expect(screen.getByText('4 cells')).toBeInTheDocument(); // count badge

    // Every section panel/title is present (no hidden sections).
    for (const title of [
      'Cell Voltage Heatmap',
      'Voltage Distribution',
      'Cell Voltage Bar Chart',
      'Cell Voltage Over Time',
      'Imbalance Trend',
      'Voltage Spread Trend',
      'Cell Details',
      'Temperature Summary',
      'Health Recommendations',
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it('re-converts SI temperatures to the user °F preference at the render boundary', () => {
    h.temp = '°F';
    h.query = makeQuery({ data: makeData() });

    renderPage();

    // 25°C → 77°F, 22°C → 71.6°F, 30°C → 86°F; spread 8°C·1.8 → 14.4°F.
    expect(screen.getByText('77.0°F')).toBeInTheDocument();
    expect(screen.getByText('86.0°F')).toBeInTheDocument();
    expect(screen.getAllByText('14.4°F').length).toBeGreaterThanOrEqual(1);
    // The °C identity strings must NOT survive once the preference is °F.
    expect(screen.queryByText('25.0°C')).not.toBeInTheDocument();
    expect(screen.queryByText('8.0°C')).not.toBeInTheDocument();
  });

  it('shows a skeleton in every panel while loading and leaks no ready values', () => {
    h.query = makeQuery({ isLoading: true, isFetching: true, dataUpdatedAt: 0 });

    const { container } = renderPage();

    expect(screen.getByRole('heading', { name: /Battery Cells/i, level: 1 })).toBeInTheDocument();
    expect(screen.queryByText('3.9025 V')).not.toBeInTheDocument();
    expect(screen.queryByText('25.0°C')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('surfaces QueryError in the data panels and wires Retry to the query refetch', () => {
    h.query = makeQuery({ isError: true, error: new Error('boom'), dataUpdatedAt: 0 });

    renderPage();

    const errors = screen.getAllByText(/Can't reach server/i);
    expect(errors.length).toBeGreaterThan(0);

    const retryButtons = screen.getAllByRole('button', { name: /^Retry$/i });
    expect(retryButtons.length).toBeGreaterThan(0);

    fireEvent.click(retryButtons[0]);
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('renders a per-section EmptyState (never a blank panel) when there are no cells', () => {
    h.query = makeQuery({ data: makeEmptyData() });

    renderPage();

    expect(screen.getByText('No cell readings available.')).toBeInTheDocument();
    expect(screen.getByText('No distribution data available.')).toBeInTheDocument();
    expect(screen.getByText('No cell voltages available.')).toBeInTheDocument();
    expect(screen.getByText('No cell details available.')).toBeInTheDocument();
    expect(screen.getByText('Not enough history for spread trend')).toBeInTheDocument();
    expect(screen.getAllByText('Not enough history yet.').length).toBeGreaterThanOrEqual(2);
    // Min/Max-cell KPIs degrade to an em dash rather than crashing.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('renders <NoVehicleSelected> instead of data scaffolding when no vehicle is selected', () => {
    h.selected.vehicleId = null;

    renderPage();

    expect(screen.getByText(/No vehicle selected/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Set up TeslaSync/i })).toBeInTheDocument();
    // The data scaffolding must NOT render behind the guard.
    expect(screen.queryByText('Cell Voltage Heatmap')).not.toBeInTheDocument();
    expect(screen.queryByText('3.9025 V')).not.toBeInTheDocument();
  });

  it('toggles between the heatmap and bar view and updates the accessible label', () => {
    renderPage();

    // Heatmap is the default view — its legend is present.
    expect(screen.getByText('Nominal')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Switch to bar view' });

    fireEvent.click(toggle);

    // View swapped to the bar chart: label flips, heatmap legend is gone.
    expect(screen.getByRole('button', { name: 'Switch to grid view' })).toBeInTheDocument();
    expect(screen.queryByText('Nominal')).not.toBeInTheDocument();
  });

  it('re-sorts the cell table and updates aria-sort when a column header is clicked', () => {
    renderPage();

    // Default sort is cell_number ascending.
    const cellHeaderBtn = screen.getByRole('button', { name: 'Cell #' });
    expect(cellHeaderBtn.closest('th')).toHaveAttribute('aria-sort', 'ascending');

    // Clicking Voltage takes over the sort (descending) and clears the old key.
    const voltageHeaderBtn = screen.getByRole('button', { name: 'Voltage (V)' });
    fireEvent.click(voltageHeaderBtn);

    expect(voltageHeaderBtn.closest('th')).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('button', { name: 'Cell #' }).closest('th')).not.toHaveAttribute('aria-sort');
  });
});

describe('cellColor', () => {
  it('maps deviation magnitude (mV) to the nominal/slight/significant palette', () => {
    expect(cellColor(3.9, 3.9)).toBe('#10b981'); // 0 mV — nominal (emerald)
    expect(cellColor(3.9, 3.91)).toBe('#f59e0b'); // 10 mV — slight (amber)
    expect(cellColor(3.9, 3.93)).toBe('#ef4444'); // 30 mV — significant (rose)
  });

  it('crosses the 5 mV and 15 mV branch thresholds in the correct direction', () => {
    // Values are kept ~1 mV clear of the exact thresholds so IEEE-754
    // rounding of `(v - avg) * 1000` can't flip the branch under test.
    expect(cellColor(0, 0.004)).toBe('#10b981'); // ~4 mV → still nominal
    expect(cellColor(0, 0.006)).toBe('#f59e0b'); // ~6 mV → slight
    expect(cellColor(0, 0.014)).toBe('#f59e0b'); // ~14 mV → slight
    expect(cellColor(0, 0.016)).toBe('#ef4444'); // ~16 mV → significant
  });
});

describe('buildHistogram', () => {
  it('returns an empty array for no cells', () => {
    expect(buildHistogram([])).toEqual([]);
  });

  it('bins distinct voltages into 6–12 buckets whose counts sum to the cell total', () => {
    const cells: CellReading[] = [3.85, 3.9, 3.95, 4.0].map((voltage, i) => ({
      cell_number: i + 1,
      voltage,
      delta_from_avg: 0,
      status: 'normal',
    }));

    const hist = buildHistogram(cells);

    expect(hist.length).toBe(6);
    expect(hist.reduce((sum, b) => sum + b.count, 0)).toBe(cells.length);
    expect(typeof hist[0].bucket).toBe('string');
  });

  it('collapses an all-equal pack into a single populated bucket with no NaN labels', () => {
    const cells: CellReading[] = Array.from({ length: 5 }, (_, i) => ({
      cell_number: i + 1,
      voltage: 3.9,
      delta_from_avg: 0,
      status: 'normal',
    }));

    const hist = buildHistogram(cells);

    expect(hist[0].count).toBe(5);
    expect(hist.reduce((sum, b) => sum + b.count, 0)).toBe(5);
    expect(hist[0].bucket).not.toContain('NaN');
  });
});
