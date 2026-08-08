/**
 * BatteryDegradationPage — behaviour + hardening coverage.
 *
 * The page exposes a single default export. This suite drives it through every
 * meaningful branch by mocking its two data hooks (`useBatteryHealthAnalytics` /
 * `useBatteryDegradation`), the selected vehicle, and the unit preference.
 * Network is never touched.
 *
 * Facets covered:
 *   - loading: page + panel scaffolding renders; KPI values, the health gauge,
 *     the projection chart, and the prediction block are all withheld (skeletons).
 *   - populated happy path: honest KPI tiles, SOH gauge health verdict, the
 *     projection chart surface (role="img"), the prediction block, the charging-
 *     habits banner, risk-factor scores, recommendations, health-factor sub-cards,
 *     the degradation history table, and hook-wiring (stringified vehicle id).
 *   - SOH verdict branches (Excellent / Good / Degraded) via `sohColor`+Badge.
 *   - Battery-age formatting branches (`ageLabel`: months / "Ny Mm" / "N years")
 *     AND the hardened non-finite guard (undefined age → "0 months", never "NaN").
 *   - unit boundary: switching the display unit to miles re-runs the real SI
 *     converter (km → mi) at the render edge for the odometer/range columns.
 *   - empty states: every data source shows its own placeholder; the charging
 *     banner survives a null `charging_habits` object (0% fast charges).
 *   - degradation-absent branch: prediction/habits/risk/recommendations each fall
 *     back to their own empty state while the health-driven panels stay intact.
 *   - per-query error isolation: a health-query 5xx surfaces QueryError in every
 *     health-driven panel (including the hardened gauge) without touching the
 *     degradation panels, and vice-versa.
 *   - a11y + interaction: labelled region landmarks, the projection chart image
 *     label, and the vehicle-scope combobox (changing it calls setVehicleId).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/resilience';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtNumber } from '@/lib/numberFormat';
import type { BatteryHealthAnalytics, DegradationData } from '@/types/energy';

// ── i18n stub: resolve the fallback (or the key when it IS the template) and
//    interpolate any {{var}} placeholders from the options bag. ──────────────
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
      return interpolate(second, third as Record<string, unknown> | undefined);
    }
    if (second && typeof second === 'object') {
      return interpolate(key, second as Record<string, unknown>);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── framer-motion: strip animation props, keep motion.div + useReducedMotion. ──
vi.mock('framer-motion', () => {
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
          const safe: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (
              k === 'animate' ||
              k === 'initial' ||
              k === 'exit' ||
              k === 'transition' ||
              k === 'whileHover' ||
              k === 'whileTap' ||
              k === 'whileInView' ||
              k === 'viewport' ||
              k === 'variants'
            )
              continue;
            safe[k] = v;
          }
          return <div {...(safe as Record<string, unknown>)}>{children}</div>;
        },
    },
  );
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReducedMotion: () => true,
  };
});

// ── Data + environment hooks, driven per test. ──
vi.mock('@/api/hooks/useEnergy', () => ({
  useBatteryHealthAnalytics: vi.fn(),
  useBatteryDegradation: vi.fn(),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));

// The projection chart uses <ChartContainer annotations=…>, whose annotation
// hooks reach for a <ToastProvider> (via useMutationToast) and the network.
// Neither is relevant here — stub them to inert no-ops so the chart mounts.
vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: () => ({ annotations: [] }),
  useCreateAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { useBatteryHealthAnalytics, useBatteryDegradation } from '@/api/hooks/useEnergy';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import BatteryDegradationPage from './BatteryDegradationPage';

const mockHealth = useBatteryHealthAnalytics as unknown as ReturnType<typeof vi.fn>;
const mockDeg = useBatteryDegradation as unknown as ReturnType<typeof vi.fn>;
const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockUnits = useUnits as unknown as ReturnType<typeof vi.fn>;

 
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

const HEALTH: BatteryHealthAnalytics = {
  current_soh: 91,
  estimated_capacity: 72.5,
  original_capacity: 78,
  degradation_rate_yr: 2.1,
  battery_age_months: 30, // → "2y 6m"
  total_cycles: 412,
  avg_depth_of_discharge: 40, // cycle-depth score = round(100 - 40) = 60
  fast_charge_pct: 35,
  full_charge_pct: 10,
  charge_habits_score: 82,
  temp_exposure_score: 70,
  history: [
    { date: '2023-01-01', odometer: 10000, soh_pct: 99, capacity_wh: 78000, range_km: 500 },
    { date: '2023-06-01', odometer: 20000, soh_pct: 95, capacity_wh: 75000, range_km: 480 },
    { date: '2024-01-01', odometer: 30000, soh_pct: 91, capacity_wh: 72500, range_km: 455 },
  ],
};

const DEG: DegradationData = {
  current_health: 91,
  current_capacity: 72.5,
  current_cycles: 412,
  current_range: 455,
  current_temp: 22,
  stress_level: 'Medium',
  fast_charge_ratio: 0.4,
  snapshots: [],
  monthly_trend: [],
  prediction: {
    has_enough_data: true,
    slope_per_year: -2.1,
    years_to_80_pct: 5.3,
    predicted_date: '2029-06-01',
    projection_points: [],
  },
  charging_habits: {
    fast_charge_count: 40,
    slow_charge_count: 60,
    deep_discharge_count: 5,
    charge_to_full_count: 3,
    high_soc_count: 8,
    total_count: 100,
  },
  current_health_pct: 91,
  degradation_rate_pct_per_month: 0.17,
  projected_80pct_date: '2029-06-01',
  projections: [
    { date: '2025-01-01', health_pct: 89, confidence_low: 87, confidence_high: 91 },
    { date: '2026-01-01', health_pct: 87, confidence_low: 84, confidence_high: 90 },
  ],
  risk_factors: [
    { name: 'fast_charge_ratio', score: 40, label: 'Medium', detail: '40% of charges are fast' },
    { name: 'high_soc_charging', score: 20, label: 'Low', detail: 'Rarely charges above 90%' },
  ],
  recommendations: ['Charge to 80% for daily use', 'Avoid Superchargers when possible'],
};

const FLEET = [
  { id: 7, display_name: 'My Model 3', vin: 'VIN00007' },
  { id: 8, display_name: 'My Model Y', vin: 'VIN00008' },
];

const setVehicleId = vi.fn();
function selected(vehicleId: number | null) {
  return {
    vehicleId,
    vehicle: vehicleId != null ? FLEET.find((v) => v.id === vehicleId) ?? null : null,
    vehicles: FLEET,
    setVehicleId,
  };
}

// A deterministic energy formatter matching the hook contract (Wh → kWh).
const formatEnergy = (v: number | null | undefined, opts?: { precision?: number }): string =>
  `${(Number(v ?? 0) / 1000).toFixed(opts?.precision ?? 1)} kWh`;

function unitReturn(distance: 'km' | 'mi') {
  return {
    unitPrefs: { distance, speed: distance === 'mi' ? 'mph' : 'km/h' },
    formatEnergy,
    formatDistance: (v: number) => String(v),
    formatSpeed: (v: number) => String(v),
    formatTemperature: (v: number) => String(v),
    formatPressure: (v: number) => String(v),
    formatDuration: (v: number) => String(v),
    formatPower: (v: number) => String(v),
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <BatteryDegradationPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const TREND_IMG = 'Battery health trend and 95% confidence projection chart';
const kpiRegion = () => screen.getByRole('region', { name: 'Battery health summary' });
const heroRegion = () => screen.getByRole('region', { name: 'Health Trend & Projection' });

/** Value <p> that immediately follows a MetricCard's label. */
function metricValue(region: HTMLElement, label: string): string {
  return within(region).getByText(label).closest('p')?.nextElementSibling?.textContent ?? '';
}

beforeEach(() => {
  mockHealth.mockReset();
  mockDeg.mockReset();
  mockSelected.mockReset();
  mockUnits.mockReset();
  setVehicleId.mockReset();

  mockUnits.mockReturnValue(unitReturn('km'));
  mockSelected.mockReturnValue(selected(7));
  mockHealth.mockReturnValue(makeQuery({ data: HEALTH }));
  mockDeg.mockReturnValue(makeQuery({ data: DEG }));
});

describe('BatteryDegradationPage — loading', () => {
  it('keeps the page shell but withholds KPI values, gauge, prediction, and table', () => {
    mockHealth.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    mockDeg.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    renderPage();

    expect(screen.getByRole('heading', { name: 'Battery Degradation', level: 1 })).toBeInTheDocument();
    // "Current SOH" labels the KPI tile AND the gauge — both sit behind skeletons.
    expect(screen.queryByText('Current SOH')).toBeNull();
    // The gauge verdict badge is withheld while its skeleton stands in.
    expect(screen.queryByText('Excellent')).toBeNull();
    // The prediction block is a skeleton, so its copy is absent.
    expect(screen.queryByText(/in approximately/)).toBeNull();
    // The history table is replaced by a skeleton while health data loads.
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('BatteryDegradationPage — populated (km)', () => {
  it('derives honest KPI tiles from /analytics/battery-health', () => {
    renderPage();
    const kpi = kpiRegion();

    expect(metricValue(kpi, 'Current SOH')).toBe('91.00%');
    expect(metricValue(kpi, 'Estimated Capacity')).toBe('72.50 kWh');
    expect(metricValue(kpi, 'Degradation Rate')).toBe('2.10%/yr');
    // battery_age_months 30 → 2 years, 6 months.
    expect(metricValue(kpi, 'Battery Age')).toBe('2y 6m');
  });

  it('renders the SOH gauge verdict and the projection chart surface', () => {
    renderPage();
    const hero = heroRegion();

    // soh 91 (> 90) → "Excellent".
    expect(within(hero).getByText('Excellent')).toBeInTheDocument();
    expect(within(hero).getByRole('img', { name: TREND_IMG })).toBeInTheDocument();
  });

  it('renders the prediction block and the charging-habits banner', () => {
    renderPage();

    // years_to_80_pct 5.3 → "~5.30 years", plus the predicted date.
    expect(screen.getByText(/in approximately/)).toBeInTheDocument();
    expect(screen.getByText(/2029-06-01/)).toBeInTheDocument();
    expect(screen.getByText('Total Cycles').closest('p')?.nextElementSibling?.textContent).toBe('412.00');

    // 40 fast + 60 slow → 40% fast charges; 5 deep discharges; Medium stress.
    expect(screen.getByText(/40% fast charges/)).toBeInTheDocument();
    expect(screen.getByText(/5 deep discharges/)).toBeInTheDocument();
    expect(screen.getByText(/Consider reducing fast charging frequency/)).toBeInTheDocument();
  });

  it('renders risk factors, recommendations, and health-factor sub-cards', () => {
    renderPage();

    // Risk factor #1 — label, score bar sublabel, and detail copy.
    expect(screen.getByText('fast charge ratio')).toBeInTheDocument();
    expect(screen.getByText('40/100')).toBeInTheDocument();
    expect(screen.getByText('40% of charges are fast')).toBeInTheDocument();

    expect(screen.getByText('Charge to 80% for daily use')).toBeInTheDocument();

    // Health factors: charge-habits (82), temperature (70), cycle-depth (60).
    expect(screen.getByText('Charge Habits').closest('div')?.querySelector('span')?.textContent).toBeTruthy();
    expect(screen.getByText('82.00/100')).toBeInTheDocument();
    expect(screen.getByText('70.00/100')).toBeInTheDocument();
    expect(screen.getByText('60.00/100')).toBeInTheDocument();
  });

  it('renders the degradation history table and wires the hooks with the string vehicle id', () => {
    renderPage();

    const table = screen.getByRole('table');
    for (const header of ['Date', 'Odometer', 'SOH %', 'Capacity', 'Range']) {
      expect(within(table).getByText(header)).toBeInTheDocument();
    }
    // Odometer 20,000 km rendered in km at global precision 2.
    expect(within(table).getByText('20,000.00 km')).toBeInTheDocument();
    // Capacity 75,000 Wh → 75.0 kWh (precision 1).
    expect(within(table).getByText('75.0 kWh')).toBeInTheDocument();

    expect(mockHealth).toHaveBeenCalledWith('7');
    expect(mockDeg).toHaveBeenCalledWith('7');
  });
});

describe('BatteryDegradationPage — SOH verdict + battery-age branches', () => {
  it.each([
    [95, 'Excellent'],
    [85, 'Good'],
    [70, 'Degraded'],
  ])('maps SOH %s to the "%s" verdict badge', (soh, verdict) => {
    mockHealth.mockReturnValue(makeQuery({ data: { ...HEALTH, current_soh: soh } }));
    renderPage();
    expect(within(heroRegion()).getByText(verdict)).toBeInTheDocument();
  });

  it.each([
    [6, '6 months'],
    [24, '2 years'],
    [30, '2y 6m'],
  ])('formats a %s-month pack age as "%s"', (months, label) => {
    mockHealth.mockReturnValue(makeQuery({ data: { ...HEALTH, battery_age_months: months } }));
    renderPage();
    expect(metricValue(kpiRegion(), 'Battery Age')).toBe(label);
  });

  it('guards a non-finite pack age (undefined → "0 months", never "NaN")', () => {
    mockHealth.mockReturnValue(
       
      makeQuery({ data: { ...HEALTH, battery_age_months: undefined as any } }),
    );
    renderPage();
    expect(metricValue(kpiRegion(), 'Battery Age')).toBe('0 months');
  });
});

describe('BatteryDegradationPage — unit boundary (miles)', () => {
  it('converts SI km → mi at the render edge for the odometer column', () => {
    mockUnits.mockReturnValue(unitReturn('mi'));
    renderPage();

    // 20,000 km → 20,000,000 m ÷ 1609.344 ≈ 12,427.42 mi (real converter).
    const expected = `${fmtNumber(convertDistanceFromSI(20000 * 1000, 'mi'))} mi`;
    expect(within(screen.getByRole('table')).getByText(expected)).toBeInTheDocument();
    // The km rendering must be gone.
    expect(screen.queryByText('20,000.00 km')).toBeNull();
  });
});

describe('BatteryDegradationPage — empty states', () => {
  it('shows a dedicated placeholder for every empty data source', () => {
    mockHealth.mockReturnValue(makeQuery({ data: { ...HEALTH, history: [] } }));
    mockDeg.mockReturnValue(
      makeQuery({
        data: {
          ...DEG,
          prediction: null,
          charging_habits: null,
          projections: [],
          risk_factors: [],
          recommendations: [],
        },
      }),
    );
    renderPage();

    // Projection chart (ChartContainer) empties to its shared placeholder.
    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.getByText(/Range data will appear/)).toBeInTheDocument();
    expect(screen.getByText(/Need more data points/)).toBeInTheDocument();
    expect(screen.getByText(/Risk data will appear/)).toBeInTheDocument();
    expect(screen.getByText(/Recommendations will appear/)).toBeInTheDocument();
    expect(screen.getByText('No degradation records found.')).toBeInTheDocument();

    // Charging banner survives a null habits object: 0 fast, 0 deep discharges.
    expect(screen.getByText(/0% fast charges/)).toBeInTheDocument();
  });

  it('falls back per-panel when the degradation query has no data', () => {
    mockDeg.mockReturnValue(makeQuery({ data: undefined }));
    renderPage();

    // Degradation-driven panels each show their own empty state...
    expect(screen.getByText(/Need more data points/)).toBeInTheDocument();
    expect(screen.getByText(/Charging impact will appear/)).toBeInTheDocument();
    expect(screen.getByText(/Risk data will appear/)).toBeInTheDocument();
    expect(screen.getByText(/Recommendations will appear/)).toBeInTheDocument();

    // ...while the health-driven KPIs stay intact.
    expect(metricValue(kpiRegion(), 'Current SOH')).toBe('91.00%');
  });
});

describe('BatteryDegradationPage — per-query error isolation', () => {
  it('surfaces the health error in every health panel (incl. the gauge) but not the prediction', () => {
    mockHealth.mockReturnValue(
      makeQuery({ data: undefined, error: new ApiError('boom', 500), isError: true }),
    );
    renderPage();

    // KPI band, gauge, range-loss, health-factors, history, and the trend panel
    // all render QueryError → several "Server error" titles.
    expect(screen.getAllByText('Server error').length).toBeGreaterThanOrEqual(3);
    // The hardened gauge shows the error instead of a misleading 0% verdict.
    expect(within(heroRegion()).queryByText('Degraded')).toBeNull();
    // Degradation panels are healthy — the prediction copy still renders.
    expect(screen.getByText(/in approximately/)).toBeInTheDocument();
  });

  it('surfaces the degradation error in its panels but leaves the health KPIs intact', () => {
    mockDeg.mockReturnValue(
      makeQuery({ data: undefined, error: new ApiError('down', 500), isError: true }),
    );
    renderPage();

    expect(screen.getAllByText('Server error').length).toBeGreaterThanOrEqual(3);
    // Health-driven KPIs + gauge verdict remain.
    expect(metricValue(kpiRegion(), 'Current SOH')).toBe('91.00%');
    expect(within(heroRegion()).getByText('Excellent')).toBeInTheDocument();
    // The prediction copy is replaced by the error, so it must be gone.
    expect(screen.queryByText(/in approximately/)).toBeNull();
  });
});

describe('BatteryDegradationPage — a11y + interaction', () => {
  it('exposes labelled landmarks, the chart image, and a working vehicle picker', () => {
    renderPage();

    expect(screen.getByRole('region', { name: 'Battery health summary' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Health Trend & Projection' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: TREND_IMG })).toBeInTheDocument();

    const picker = screen.getByRole('combobox', { name: 'Select vehicle' });
    expect(picker).toHaveValue('7');

    fireEvent.change(picker, { target: { value: '8' } });
    expect(setVehicleId).toHaveBeenCalledWith(8);
  });
});
