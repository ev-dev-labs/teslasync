/**
 * EnergyFlowPage contract + hardening tests.
 *
 * EnergyFlowPage renders the SI-canonical energy dashboard: a KPI band, a live
 * energy-flow diagram + live-power breakdown (from `useEnergyFlow`), and four
 * historical sections (usage area chart, efficiency metrics, daily distance +
 * efficiency bar charts, and a sortable history table) driven by
 * `useEnergyStats`.
 *
 * Both data hooks are mocked at the hook boundary so each section's
 * loading / error / empty / no-vehicle branch can be exercised deterministically
 * (recharts renders nothing meaningful in jsdom, so the component tests assert
 * the page's OWN branch selection — content vs. placeholder — rather than SVG
 * internals). The display hooks (`useUnits` → `useSettings`) render for real, so
 * the SI → display unit conversion at the render boundary is exercised for both
 * metric (km) and imperial (mi) preferences.
 *
 * The exported pure helpers (`scaleEfficiency`, `efficiencyRating`,
 * `computeChargePower`, `buildDailyChartData`, `buildEfficiencyChartData`) are
 * unit-tested directly with exact numeric assertions. `buildDailyChartData`
 * carries a regression guard for the fixed unit-mislabel bug: the daily charts
 * now plot DISPLAY units (kWh / km|mi), not raw SI metres/watt-hours.
 *
 * Network never touches the real backend — the two energy hooks are stubbed and
 * `useSelectedVehicle` is mocked so no vehicles query fires.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// i18n stub: return the fallback string, interpolating {{var}} tokens so
// assertions can target the rendered English copy. When called with a bare
// key (e.g. t('Charging')) it echoes the key.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          const o = opts as Record<string, unknown>;
          return fallbackOrOpts.replace(/{{(\w+)}}/g, (_m, name: string) =>
            name in o ? String(o[name]) : `{{${name}}}`,
          );
        }
        return fallbackOrOpts;
      }
      if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
        const o = fallbackOrOpts as Record<string, unknown>;
        if (typeof o.defaultValue === 'string') return o.defaultValue;
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// Mutable unit preference so one file exercises both the metric (km) and
// imperial (mi) display-conversion branches. Hoisted so the settings mock
// factory can close over it.
const unitState = vi.hoisted(() => ({ length: 'km' as 'km' | 'mi' }));

// File-level useSettings mock (overrides the global test-setup stub). Mirrors
// the production defaults so every transitive consumer sees the same shape but
// lets `unit_of_length` flip per test.
vi.mock('@/hooks/useSettings', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useSettings')>();
  const defaults = {
    unit_of_length: 'km' as const,
    unit_of_temp: 'C' as const,
    unit_of_pressure: 'bar' as const,
    preferred_range: 'rated' as const,
    language: 'en',
    base_cost_per_kwh: 0.12,
    api_suspended: false,
    theme: 'neon-cyan',
    mode: 'dark' as const,
    custom_primary: '#00b4d8',
    custom_accent: '#e63946',
    gas_price_per_unit: 0,
    gas_unit: 'gallon' as const,
    gas_efficiency_mpg: 25,
    decimal_precision: 2,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    alert_digest_mode: 'instant' as const,
    currency_symbol: '$',
    locale: 'en-US',
    tz_display_default: 'vehicle' as const,
    timezone_user: '',
    tab_badge_enabled: true,
    critical_flash_enabled: true,
    ui_density: 'comfortable' as const,
    time_format_default: 'relative' as const,
    chart_palette: 'cb_safe' as const,
    ai_mode: 'off' as const,
    ai_features: {},
    ai_provider_config: {},
    ai_cost_cap_cents: 0,
  };
  return {
    ...actual,
    useSettings: () => ({
      settings: { ...defaults, unit_of_length: unitState.length },
      isMiles: unitState.length === 'mi',
      isFahrenheit: false,
      isPSI: false,
      decimals: 2,
      locale: 'en-US',
      density: 'comfortable' as const,
      rangeType: 'rated' as const,
    }),
  };
});

vi.mock('@/api/hooks/useEnergy', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useEnergy')>();
  return { ...actual, useEnergyStats: vi.fn(), useEnergyFlow: vi.fn() };
});

vi.mock('@/hooks/useSelectedVehicle', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useSelectedVehicle')>();
  return { ...actual, useSelectedVehicle: vi.fn() };
});

// jsdom lacks matchMedia; framer-motion (via <FadeIn>) reads it.
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

import { useEnergyStats, useEnergyFlow } from '@/api/hooks/useEnergy';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import type { DailyEnergy } from '@/types/energy';
import EnergyFlowPage, {
  scaleEfficiency,
  efficiencyRating,
  computeChargePower,
  buildDailyChartData,
  buildEfficiencyChartData,
} from './EnergyFlowPage';

const mockStats = vi.mocked(useEnergyStats);
const mockFlow = vi.mocked(useEnergyFlow);
const mockSelectedVehicle = vi.mocked(useSelectedVehicle);

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    isError: false,
    isStale: false,
    isFetching: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function makeDay(over: Partial<DailyEnergy> = {}): DailyEnergy {
  return {
    date: '2025-03-05',
    energy_wh: 10_000,
    cost: 2,
    distance_m: 50_000,
    efficiency_wh_per_m: 0.2,
    ...over,
  };
}

function makeStatsData(over: Record<string, unknown> = {}) {
  return {
    vehicle_id: 1,
    period_days: 7,
    total_energy_used_wh: 42_000, // 42.00 kWh
    total_energy_charged_wh: 55_500, // 55.50 kWh
    total_wh: 42_000,
    total_cost: 25,
    total_distance_m: 123_000, // 123.00 km / 76.43 mi
    avg_efficiency_wh_per_m: 0.16, // 160 Wh/km / 257 Wh/mi
    co2_saved_kg: 12.3,
    daily_breakdown: [
      // Deliberately: newer date has LOWER energy so a sort-by-energy flips
      // the default date-desc order (regression-guards the sort wiring).
      makeDay({ date: '2025-03-05', energy_wh: 20_000, distance_m: 50_000, efficiency_wh_per_m: 0.2 }),
      makeDay({ date: '2025-03-06', energy_wh: 10_000, distance_m: 30_000, efficiency_wh_per_m: 0.15 }),
    ],
    ...over,
  };
}

function makeFlowData(over: Record<string, unknown> = {}) {
  return {
    dc_charging_power: 11,
    ac_charging_power: 0,
    energy_remaining: 62.5,
    pack_voltage: 400,
    pack_current: 27.5,
    soc: 82,
    charge_state: 'Charging',
    ...over,
  };
}

function installHappyPath() {
  mockSelectedVehicle.mockReturnValue({
    vehicleId: 1,
    vehicle: null,
    vehicles: [
      { id: 1, display_name: 'Car One', vin: 'VIN1' },
      { id: 2, display_name: 'Car Two', vin: 'VIN2' },
    ] as any,
    setVehicleId: vi.fn(),
  });
  mockStats.mockReturnValue(qr({ data: makeStatsData() }));
  mockFlow.mockReturnValue(qr({ data: makeFlowData() }));
}

function renderPage(entries: string[] = ['/battery/energy']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={entries}>
      <QueryClientProvider client={client}>
        <EnergyFlowPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function kpiRegion() {
  return screen.getByRole('region', { name: 'Energy summary metrics' });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  unitState.length = 'km';
  installHappyPath();
});

/* ───────────────────────── Pure helper unit tests ───────────────────────── */

describe('scaleEfficiency', () => {
  it('converts SI Wh/m to whole Wh per display distance unit', () => {
    expect(scaleEfficiency(0.16, 'km')).toBe(160); // 0.16 * 1000
    expect(scaleEfficiency(0.2, 'km')).toBe(200);
    expect(scaleEfficiency(0.16, 'mi')).toBe(257); // round(0.16 * 1609.344)
  });

  it('treats null / undefined as 0 (never NaN)', () => {
    expect(scaleEfficiency(null, 'km')).toBe(0);
    expect(scaleEfficiency(undefined, 'mi')).toBe(0);
  });
});

describe('efficiencyRating', () => {
  it('buckets metric (km) thresholds: none / excellent / good / high', () => {
    expect(efficiencyRating(0, 'km')).toBe('none');
    expect(efficiencyRating(120, 'km')).toBe('excellent'); // < 150
    expect(efficiencyRating(175, 'km')).toBe('good'); // 150..200
    expect(efficiencyRating(260, 'km')).toBe('high'); // >= 200
  });

  it('uses the wider imperial (mi) thresholds and rejects non-positive input', () => {
    expect(efficiencyRating(200, 'mi')).toBe('excellent'); // < 240
    expect(efficiencyRating(300, 'mi')).toBe('good'); // 240..320
    expect(efficiencyRating(400, 'mi')).toBe('high'); // >= 320
    expect(efficiencyRating(-5, 'km')).toBe('none');
    expect(efficiencyRating(Number.NaN, 'km')).toBe('none');
  });
});

describe('computeChargePower', () => {
  it('sums DC + AC power, treating null legs as 0', () => {
    expect(computeChargePower({ dc_charging_power: 10, ac_charging_power: 5 } as any)).toBe(15);
    expect(computeChargePower({ dc_charging_power: null, ac_charging_power: 7 } as any)).toBe(7);
  });

  it('returns 0 for missing flow data', () => {
    expect(computeChargePower(null)).toBe(0);
    expect(computeChargePower(undefined)).toBe(0);
  });
});

describe('buildDailyChartData', () => {
  it('plots DISPLAY units, not raw SI (regression: distance mislabel bug)', () => {
    const rows = [makeDay({ date: '2025-03-05', energy_wh: 50_000, distance_m: 50_000 })];
    const km = buildDailyChartData(rows, 'km');
    expect(km[0].energy).toBe(50); // 50_000 Wh → 50 kWh, NOT 50_000
    expect(km[0].distance).toBe(50); // 50_000 m → 50 km, NOT 50_000
    expect(typeof km[0].date).toBe('string');

    const mi = buildDailyChartData([makeDay({ distance_m: 1609.344, energy_wh: 1000 })], 'mi');
    expect(mi[0].distance).toBeCloseTo(1, 5); // 1609.344 m → 1 mi
    expect(mi[0].energy).toBe(1); // 1000 Wh → 1 kWh
  });

  it('null-safes missing energy / distance to 0', () => {
    const rows = [makeDay({ energy_wh: null as any, distance_m: null as any })];
    const out = buildDailyChartData(rows, 'km');
    expect(out[0].energy).toBe(0);
    expect(out[0].distance).toBe(0);
  });
});

describe('buildEfficiencyChartData', () => {
  it('drops days without a positive efficiency and scales the rest', () => {
    const rows = [
      makeDay({ date: 'a', efficiency_wh_per_m: 0.2 }),
      makeDay({ date: 'b', efficiency_wh_per_m: 0 }),
      makeDay({ date: 'c', efficiency_wh_per_m: null as any }),
    ];
    const out = buildEfficiencyChartData(rows, 'km');
    expect(out).toHaveLength(1);
    expect(out[0].efficiency).toBe(200); // 0.2 Wh/m → 200 Wh/km
  });
});

/* ─────────────────────────── Component tests ─────────────────────────── */

describe('EnergyFlowPage — shell & KPI band', () => {
  it('renders the page title + subtitle and sets the document title', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Energy Flow' })).toBeInTheDocument();
    expect(screen.getByText('Power distribution and energy analysis')).toBeInTheDocument();
    expect(document.title).toContain('Energy Flow');
  });

  it('renders every KPI card with km-converted values', () => {
    renderPage();
    const kpi = kpiRegion();
    expect(within(kpi).getByText('Total Energy')).toBeInTheDocument();
    expect(within(kpi).getByText('42.00 kWh')).toBeInTheDocument();
    expect(within(kpi).getByText('55.50 kWh')).toBeInTheDocument();
    expect(within(kpi).getByText('123.00 km')).toBeInTheDocument();
    expect(within(kpi).getByText('160')).toBeInTheDocument(); // efficiency (Wh/km)
    expect(within(kpi).getByText('12.3')).toBeInTheDocument(); // CO2
    expect(within(kpi).getByText('7')).toBeInTheDocument(); // period days
  });

  it('shows an em-dash placeholder in the KPI band when no vehicle is selected', () => {
    mockSelectedVehicle.mockReturnValue({
      vehicleId: null,
      vehicle: null,
      vehicles: [] as any,
      setVehicleId: vi.fn(),
    });
    mockStats.mockReturnValue(qr({ data: undefined }));
    mockFlow.mockReturnValue(qr({ data: undefined }));
    renderPage();

    // Silent-zero hardening: no misleading "0.00 kWh" while data is unknown.
    expect(within(kpiRegion()).queryByText('0.00 kWh')).not.toBeInTheDocument();
    expect(within(kpiRegion()).getAllByText('—').length).toBeGreaterThanOrEqual(6);
    // Every data section falls back to the no-vehicle prompt.
    expect(
      screen.getAllByText('Select a vehicle to view its energy flow.').length,
    ).toBeGreaterThanOrEqual(5);
  });

  it('converts KPI values to imperial units when the preference is miles', () => {
    unitState.length = 'mi';
    renderPage();
    const kpi = kpiRegion();
    expect(within(kpi).getByText('76.43 mi')).toBeInTheDocument(); // 123_000 m → mi
    expect(within(kpi).getByText('257')).toBeInTheDocument(); // 0.16 Wh/m → 257 Wh/mi
    expect(within(kpi).getAllByText('Wh/mi').length).toBeGreaterThanOrEqual(1);
  });
});

describe('EnergyFlowPage — live energy flow', () => {
  it('renders the flow diagram, SOC gauge and charge badge on the happy path', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Energy Flow Diagram' }),
    ).toBeInTheDocument();
    // "Charging" renders twice: the static flow-connector label AND the live
    // charge-state badge (proves the badge branch fired, not just the label).
    expect(screen.getAllByText('Charging').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('82')).toBeInTheDocument(); // SOC gauge value
    expect(screen.getByText('62.5 kWh')).toBeInTheDocument(); // battery energy_remaining
    expect(screen.getByText('Grid')).toBeInTheDocument();
  });

  it('renders the live-power breakdown rows', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 3, name: 'Live Power' })).toBeInTheDocument();
    expect(screen.getByText('DC Power')).toBeInTheDocument();
    expect(screen.getByText('AC Power')).toBeInTheDocument();
    expect(screen.getByText('HVAC')).toBeInTheDocument();
    expect(screen.getByText('Accessories')).toBeInTheDocument();
    // DC leg = 11 kW (also the aggregate connector); AC leg = 0 kW.
    expect(screen.getAllByText('11.0 kW').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('0.0 kW')).toBeInTheDocument();
  });

  it('shows a skeleton (not the gauge) while the flow query is loading', () => {
    mockFlow.mockReturnValue(qr({ isLoading: true, isFetching: true }));
    const { container } = renderPage();
    expect(screen.queryByText('62.5 kWh')).not.toBeInTheDocument();
    expect(screen.queryByText('Charging')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('surfaces a retry-able error and re-fetches the flow on retry', async () => {
    const refetchFlow = vi.fn();
    mockFlow.mockReturnValue(qr({ error: new Error('flow down'), isError: true, refetch: refetchFlow }));
    renderPage();

    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(1);
    const retry = screen.getAllByRole('button', { name: 'Retry' })[0];
    fireEvent.click(retry);
    await waitFor(() => expect(refetchFlow).toHaveBeenCalled());
  });
});

describe('EnergyFlowPage — historical sections', () => {
  it('renders the daily-usage chart section (no empty placeholder) on the happy path', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Daily Energy Usage' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('No daily energy data available.')).not.toBeInTheDocument();
  });

  it('shows per-section empty states when the daily breakdown is empty', () => {
    mockStats.mockReturnValue(qr({ data: makeStatsData({ daily_breakdown: [] }) }));
    renderPage();
    expect(screen.getByText('No daily energy data available.')).toBeInTheDocument();
    expect(screen.getByText('No daily distance data available.')).toBeInTheDocument();
    expect(screen.getByText('No energy history records available.')).toBeInTheDocument();
  });

  it('renders the efficiency-metrics panel with a unit-aware rating badge', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Efficiency Metrics' }),
    ).toBeInTheDocument();
    // avg 160 Wh/km → "good" bucket.
    expect(screen.getByText('Good')).toBeInTheDocument();
    expect(screen.getByText('6.00 kWh')).toBeInTheDocument(); // 42_000 Wh / 7 days
  });

  it('re-fetches stats when a stats-section retry is clicked', async () => {
    const refetchStats = vi.fn();
    mockStats.mockReturnValue(
      qr({ error: new Error('stats down'), isError: true, refetch: refetchStats }),
    );
    renderPage();

    const retry = screen.getAllByRole('button', { name: 'Retry' })[0];
    fireEvent.click(retry);
    await waitFor(() => expect(refetchStats).toHaveBeenCalled());
  });

  it('renders the history table and re-sorts when the Energy header is clicked', async () => {
    renderPage();
    const table = screen.getByRole('table');

    const firstDataRowText = () => {
      const rows = within(table).getAllByRole('row');
      return rows[1]?.textContent ?? '';
    };

    // Default date-desc → the 2025-03-06 row (10 kWh) is first. Assert on the
    // energy cell rather than the rendered date, which is timezone-relative.
    expect(firstDataRowText()).toContain('10.00 kWh');

    fireEvent.click(within(table).getByRole('button', { name: 'Energy' }));

    // Energy-desc → the higher-energy 20 kWh row rises to the top.
    await waitFor(() => expect(firstDataRowText()).toContain('20.00 kWh'));
  });
});

describe('EnergyFlowPage — data contract & controls', () => {
  it('requests stats with a numeric days window derived from the URL range', () => {
    renderPage(['/battery/energy?from=2025-03-01&to=2025-03-07']);
    // Inclusive 7-day window, snake_case-free positional args, string vehicle id.
    expect(mockStats).toHaveBeenCalledWith('1', 7);
    expect(mockFlow).toHaveBeenCalledWith('1');
  });

  it('re-queries with a new window when a range preset is picked', async () => {
    renderPage(); // default 7d preset → days 7
    expect(mockStats).toHaveBeenCalledWith('1', 7);

    fireEvent.click(screen.getByTestId('energy-flow-range'));
    const listbox = await screen.findByRole('listbox', { name: 'Quick date range' });
    fireEvent.click(within(listbox).getByRole('option', { name: 'Today' }));

    await waitFor(() => expect(mockStats).toHaveBeenCalledWith('1', 1));
  });

  it('exposes accessible vehicle + range controls', () => {
    renderPage();
    expect(screen.getByRole('combobox', { name: 'Select vehicle' })).toBeInTheDocument();
    expect(screen.getByTestId('energy-flow-range')).toBeInTheDocument();
  });
});
