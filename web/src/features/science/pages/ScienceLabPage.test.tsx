/**
 * ScienceLabPage — lab contract tests.
 *
 * Each domain panel owns its query, so the five science hooks are mocked
 * at the hook boundary with full query state. Loading, error, empty, and
 * populated branches are deterministic with no network. `useSettings`
 * renders for real through the file-level mock so `useUnits` converts SI
 * through the real `unitConversion` boundary.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          const o = opts as Record<string, unknown>;
          return fallbackOrOpts.replace(/{{(\w+)}}/g, (_m, name: string) =>
            name in o ? String(o[name]) : `{{${name}}`,
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

const { settingsMock } = vi.hoisted(() => ({
  settingsMock: {
    unit_of_length: 'km',
    unit_of_temp: 'C',
    unit_of_pressure: 'kPa',
    decimal_precision: 1,
    locale: 'en-US',
    timezone_user: '',
  },
}));

vi.mock('@/hooks/useSettings', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useSettings')>();
  return {
    ...actual,
    useSettings: () => ({
      settings: settingsMock,
      isMiles: settingsMock.unit_of_length === 'mi',
      isFahrenheit: settingsMock.unit_of_temp === 'F',
      isPSI: settingsMock.unit_of_pressure === 'psi',
      decimals: 1,
      locale: 'en-US',
    }),
  };
});

const scienceMocks = vi.hoisted(() => ({
  electrochem: vi.fn(),
  thermal: vi.fn(),
  weather: vi.fn(),
  tires: vi.fn(),
  notebook: vi.fn(),
  vehicle: vi.fn(),
}));

vi.mock('@/api/hooks/useScience', () => ({
  useScienceElectrochem: scienceMocks.electrochem,
  useScienceThermal: scienceMocks.thermal,
  useScienceWeather: scienceMocks.weather,
  useScienceTires: scienceMocks.tires,
  useScienceNotebook: scienceMocks.notebook,
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: scienceMocks.vehicle,
}));

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: vi.fn(),
}));

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 640, height: 240 }),
  };
});

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

import ScienceLabPage from './ScienceLabPage';
import type {
  ScienceElectrochem,
  ScienceNotebook,
  ScienceThermal,
  ScienceTires,
  ScienceWeather,
} from '@/api/types';

function queryState(over: Record<string, unknown> = {}) {
  return {
    data: undefined,
    dataUpdatedAt: Date.now(),
    error: null,
    isError: false,
    isPending: false,
    isLoading: false,
    isFetching: false,
    isSuccess: true,
    status: 'success',
    fetchStatus: 'idle',
    refetch: vi.fn(),
    ...over,
  };
}

function electrochem(over: Partial<ScienceElectrochem> = {}): ScienceElectrochem {
  return {
    vehicle_id: 1, start: '2026-09-01T00:00:00Z', end: '2026-09-08T00:00:00Z',
    ocv_points: [{ at: '2026-09-02T00:00:00Z', ocv_pack_v: 400, soc_pct: 60, temp_c: 20, direction: 'discharge_rest', dwell_s: 1200, energy_wh: 45000, brick_spread_mv: 8 }],
    ocv_bins: [{ soc_lo_pct: 60, soc_hi_pct: 70, temp_lo_c: 20, temp_hi_c: 30, n: 4, mean_ocv_v: 400, slope_v_per_pct: null, unknown: true }],
    hysteresis: [{ soc_lo_pct: 60, soc_hi_pct: 70, temp_lo_c: 20, temp_hi_c: 30, n_charge: 1, n_discharge: 1, delta_v: null, unknown: true }],
    ir_points: [
      { at: '2026-09-02T01:00:00Z', ir_pack_ohm: 0.05, temp_c: 20, soc_pct: 60, delta_i_a: 20, delta_v_v: 1, dt_s: 5, context: 'drive_step' },
      { at: '2026-09-02T02:00:00Z', ir_pack_ohm: 0.052, temp_c: 21, soc_pct: 58, delta_i_a: 22, delta_v_v: 1.1, dt_s: 5, context: 'drive_step' },
    ],
    arrhenius: { n: 2, slope: 0, intercept: 0, r2: 0, se_slope: 0, ci95_low: 0, ci95_high: 0, ci_method: 'none', ea_j_per_mol: null, ea_ci95_low: null, ea_ci95_high: null, temp_bins: 1, temp_span_c: 2, unknown: true, honesty: 'Too few bins.' },
    pulse_ir: [],
    aging: { nominal_pack_wh: 75000, nominal_pack_source: 'assumed_reference_not_vehicle_capacity', throughput_wh: 50000, equiv_full_cycles: 0.67, rest_hours: 40, high_soc_rest_hours: 5, proxy_slope_wh_per_day: null, proxy_ci95_low: null, proxy_ci95_high: null, proxy_n: 1, holdout_rmse_wh: null, unknown: true, honesty: 'Descriptive exposure, not an aging split.' },
    capacity_proxy_wh: null, capacity_proxy_unknown: true,
    firmware_epoch: '2026.24.3', pooled_epochs: false,
    signals_used: ['PackVoltage'], missing_signals: ['cell_voltage_per_cell'],
    truncated: false, honesty: 'Pack-equivalent.',
    ...over,
  };
}

function thermal(over: Partial<ScienceThermal> = {}): ScienceThermal {
  return {
    vehicle_id: 1, start: '2026-09-01T00:00:00Z', end: '2026-09-08T00:00:00Z',
    fits: [{ start: '2026-09-02T00:00:00Z', end: '2026-09-02T06:00:00Z', kind: 'pack_cooldown', tau_s: 1800, tau_ci95_low: 1700, tau_ci95_high: 1900, t_inf_c: 15, n: 25, r2: 0.99, residual_rmse_c: 0.3, solar_unknown: true, unknown: false }],
    signals_used: ['ModuleTempMax'], truncated: false, honesty: 'Lumped capacity.',
    ...over,
  };
}

function weather(over: Partial<ScienceWeather> = {}): ScienceWeather {
  return {
    vehicle_id: 1, start: '2026-09-01T00:00:00Z', end: '2026-09-08T00:00:00Z',
    points: [{ drive_id: 7, at: '2026-09-02T08:00:00Z', lat: 37, lon: -122, temp_c: 15, pressure_hpa: 1013, wind_mps: 3, precip_mm: 0, density_kg_m3: 1.225, residual_wh_per_m: 0.16, session_wh_per_m: 0.17 }],
    density_r: null, wind_r: null, rain_n: 0, dry_n: 1, weather_unknown: false,
    signals_used: ['open_meteo_archive'], honesty: 'Correlation.',
    ...over,
  };
}

function tires(over: Partial<ScienceTires> = {}): ScienceTires {
  return {
    vehicle_id: 1, start: '2026-09-01T00:00:00Z', end: '2026-09-08T00:00:00Z',
    fl_kpa: 290, fr_kpa: 292, rl_kpa: 288, rr_kpa: 291, imbalance_kpa: 4,
    recommended_kpa: 310, underinflation_frac: 0.07, extra_wh: 35, extra_model_low: 18, extra_model_high: 52,
    distance_m: 500000, unknown: false, signals_used: ['TpmsPressureFl'],
    honesty: 'TPMS as recorded.',
    ...over,
  };
}

function notebook(over: Partial<ScienceNotebook> = {}): ScienceNotebook {
  return {
    vehicle_id: 1, start: '2026-09-01T00:00:00Z', end: '2026-09-08T00:00:00Z',
    entries: [{ id: 'electrochem.ocv:1:2026', domain: 'electrochem', hypothesis: 'Rest voltage maps SOC.', vehicle_id: 1, start: '2026-09-01T00:00:00Z', end: '2026-09-08T00:00:00Z', firmware_epoch: '2026.24.3', n: 4, method: 'rest_ocv_binned', ci_method: 'none', holdout_frac: null, holdout_rmse: null, residual_mean: null, residual_rmse: null, signals_used: ['PackVoltage'], unknown: false, honesty: 'Fit.' }],
    honesty: 'Every claim is a fit.',
    ...over,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/science']}>
        <ScienceLabPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const oneCarFleet = {
  vehicleId: 1,
  vehicle: { id: 1, display_name: 'Model 3' },
  vehicles: [{ id: 1, display_name: 'Model 3' }],
  setVehicleId: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  settingsMock.unit_of_length = 'km';
  settingsMock.unit_of_temp = 'C';
  settingsMock.unit_of_pressure = 'kPa';
  scienceMocks.vehicle.mockReturnValue(oneCarFleet);
  scienceMocks.electrochem.mockReturnValue(queryState({ data: electrochem() }));
  scienceMocks.thermal.mockReturnValue(queryState({ data: thermal() }));
  scienceMocks.weather.mockReturnValue(queryState({ data: weather() }));
  scienceMocks.tires.mockReturnValue(queryState({ data: tires() }));
  scienceMocks.notebook.mockReturnValue(queryState({ data: notebook() }));
});

describe('ScienceLabPage', () => {
  it('renders all five domain panels with data', () => {
    renderPage();
    for (const testId of ['science-electrochem', 'science-thermal', 'science-weather', 'science-tires', 'science-notebook']) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
  });

  it('shows unknown fits honestly with min-n disclosure', () => {
    renderPage();
    const panel = screen.getByTestId('science-electrochem');
    expect(panel.textContent).toMatch(/unknown/);
    expect(panel.textContent).not.toMatch(/J\/mol.*[1-9]/);
  });

  it('never prints a bare health percent', () => {
    renderPage();
    expect(screen.getByTestId('science-electrochem').textContent).not.toMatch(/\b\d{2,3}%\s*health\b/i);
    expect(screen.getByTestId('science-electrochem').textContent).toMatch(/Capacity proxy/);
  });

  it('renders missing session throughput as unknown, not zero', () => {
    const report = electrochem();
    report.aging.throughput_wh = null;
    report.aging.equiv_full_cycles = null;
    scienceMocks.electrochem.mockReturnValue(queryState({ data: report }));
    renderPage();
    expect(screen.getByTestId('science-electrochem').textContent).toMatch(/Throughput:\s*Unknown/);
  });

  it('keeps empty domains visible and provides working retry actions', async () => {
    const { fireEvent, within } = await import('@testing-library/react');
    const retry = vi.fn();
    scienceMocks.electrochem.mockReturnValue(queryState({ data: null, refetch: retry }));
    renderPage();
    const panel = screen.getByTestId('science-electrochem');
    expect(panel.textContent).toMatch(/No fit inputs/);
    fireEvent.click(within(panel).getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByTestId('science-thermal')).toBeInTheDocument();
  });

  it('retains fits and warns when a background refresh fails', () => {
    scienceMocks.electrochem.mockReturnValue(queryState({
      data: electrochem(), isError: true, error: new Error('refresh failed'),
    }));
    renderPage();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByLabelText('Pack resistance over the window')).toBeInTheDocument();
  });

  it('each panel loads and errors independently', () => {
    scienceMocks.thermal.mockReturnValue(
      queryState({ data: undefined, isPending: true, isSuccess: false, status: 'pending', fetchStatus: 'fetching' }),
    );
    scienceMocks.tires.mockReturnValue(
      queryState({ data: undefined, error: new Error('tire fail'), isError: true, isSuccess: false, status: 'error' }),
    );
    renderPage();
    expect(screen.getByTestId('science-electrochem')).toBeInTheDocument();
    expect(screen.getByTestId('science-thermal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('renders the notebook entry with n, method, and honesty', async () => {
    const { fireEvent } = await import('@testing-library/react');
    renderPage();
    const panel = screen.getByTestId('science-notebook');
    expect(panel.textContent).toMatch(/n=4/);
    fireEvent.click(screen.getByText(/electrochem · electrochem\.ocv/));
    expect(panel.textContent).toMatch(/Rest voltage maps SOC/);
    expect(panel.textContent).toMatch(/rest_ocv_binned/);
  });

  it('shows metric and imperial pressures at the unit boundary', () => {
    renderPage();
    expect(screen.getByTestId('science-tires').textContent).toMatch(/bar/);
  });

  it('shows psi pressures in imperial mode', () => {
    settingsMock.unit_of_pressure = 'psi';
    renderPage();
    expect(screen.getByTestId('science-tires').textContent).toMatch(/psi/);
  });

  it('renders weather correlation as correlation, not causation', () => {
    renderPage();
    expect(screen.getByTestId('science-weather').textContent).toMatch(/Correlation/);
  });

  it('renders the pack-IR chart as real SVG', () => {
    const { container } = renderPage();
    expect(screen.getByLabelText('Pack resistance over the window')).toBeInTheDocument();
    const chart = screen.getByTestId('science-electrochem').querySelector('.recharts-wrapper svg');
    expect(chart).not.toBeNull();
    expect(container.querySelector('.recharts-area-curve')).not.toBeNull();
  });
});
