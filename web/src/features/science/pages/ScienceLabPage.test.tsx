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
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
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
    tz_display_default: 'vehicle',
    chart_palette: 'cb_safe',
  },
}));

vi.mock('@/api/hooks/useSettings', () => ({
  useSettings: () => ({ data: settingsMock }),
}));

vi.mock('@/components/ui/ThemeProvider', async (importActual) => {
  const actual = await importActual<typeof import('@/components/ui/ThemeProvider')>();
  return {
    ...actual,
    useTheme: () => ({
      theme: { primary: 'var(--theme-primary)', accent: 'var(--theme-accent)' },
      mode: { colorScheme: 'dark' },
    }),
  };
});

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
      locale: settingsMock.locale,
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

// The global setup mock of `@/lib/timezone` drops the vehicle tz ("no
// vehicle is selected in bare renders"), which makes vehicle-mode dates
// untestable. This file selects vehicles with timezones, so override with
// a faithful resolution (identical whenever the mock vehicle has no tz).
vi.mock('@/lib/timezone', async () => {
  const actual = await vi.importActual<typeof import('@/lib/timezone')>('@/lib/timezone');
  const { useSettings } = await import('@/hooks/useSettings');
  const { useSelectedVehicle } = await import('@/hooks/useSelectedVehicle');
  return {
    ...actual,
    useTimezone: (mode: Parameters<typeof actual.useTimezone>[0] = 'vehicle') => {
      const settings = (useSettings() as { settings?: { timezone_user?: string | null } } | undefined)?.settings;
      const { vehicle } = useSelectedVehicle() as { vehicle?: { timezone?: string | null } | null };
      const userTz = settings?.timezone_user?.trim() ? settings.timezone_user : 'UTC';
      return actual.resolveTimezone(mode, vehicle?.timezone ?? undefined, userTz);
    },
  };
});

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
import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { deriveDataState } from '@/api/dataState';
import { CHART_COLORS_CB_SAFE, CHART_COLORS_NEON } from '@/lib/colors';
import * as operationalMetrics from '@/hooks/useOperationalMetrics';
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

function HeaderRangeControl() {
 const [, setParams] = useSearchParams();
 return <button data-testid="header-science-range" onClick={() => setParams(previous => {
  const next = new URLSearchParams(previous); next.set('from','2026-09-01'); next.set('to','2026-09-30'); return next;
 })}>Choose a workspace range.</button>;
}
function renderPage(route = '/science') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        {children}
        <HeaderRangeControl />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(<ScienceLabPage />, { wrapper });
  return { ...result, rerenderPage: () => result.rerender(<ScienceLabPage />) };
}

const oneCarFleet = {
  vehicleId: 1,
  vehicle: { id: 1, display_name: 'Model 3' },
  vehicles: [{ id: 1, display_name: 'Model 3' }],
  vehiclesState: deriveDataState({ data: [{ id: 1, display_name: 'Model 3' }] }),
  setVehicleId: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  settingsMock.unit_of_length = 'km';
  settingsMock.unit_of_temp = 'C';
  settingsMock.unit_of_pressure = 'kPa';
  settingsMock.chart_palette = 'cb_safe';
  settingsMock.locale = 'en-US';
  settingsMock.timezone_user = '';
  settingsMock.tz_display_default = 'vehicle';
  scienceMocks.vehicle.mockReturnValue(oneCarFleet);
  scienceMocks.electrochem.mockReturnValue(queryState({ data: electrochem() }));
  scienceMocks.thermal.mockReturnValue(queryState({ data: thermal() }));
  scienceMocks.weather.mockReturnValue(queryState({ data: weather() }));
  scienceMocks.tires.mockReturnValue(queryState({ data: tires() }));
  scienceMocks.notebook.mockReturnValue(queryState({ data: notebook() }));
});

describe('ScienceLabPage', () => {
  it.each(['loading', 'paused', 'failed', 'empty', 'retained-empty'] as const)(
    'reserves setup for confirmed absence while fleet state is %s',
    async (status) => {
      const retry = vi.fn();
      const failed = status === 'failed' || status === 'retained-empty';
      const empty = status === 'empty' || status === 'retained-empty';
      scienceMocks.vehicle.mockReturnValue({
        ...oneCarFleet,
        vehicleId: null,
        vehicle: null,
        vehicles: [],
        vehiclesState: deriveDataState({
          data: empty ? [] : undefined,
          error: failed ? new Error('Fleet lookup failed') : null,
          fetchStatus: status === 'paused' ? 'paused' : 'idle',
          refetch: retry,
        }, { unavailable: empty }),
      });
      const { unmount } = renderPage();
      try {
        expect(screen.queryByRole('link', { name: 'Set up TeslaSync' }) != null).toBe(status === 'empty');
        for (const domain of ['electrochem', 'thermal', 'weather', 'tires', 'notebook'] as const) {
          expect(scienceMocks[domain]).not.toHaveBeenCalled();
        }
        if (status === 'loading' || status === 'paused') {
          expect(screen.getByRole('status', { name: 'Loading Vehicle registry' })).toBeInTheDocument();
          if (status === 'paused') expect(screen.getByText(/Waiting for a connection/)).toBeInTheDocument();
        }
        if (failed) {
          const user = (await import('@testing-library/user-event')).default.setup();
          await user.click(screen.getByRole('button', { name: status === 'failed' ? /retry/i : 'Refresh' }));
          expect(retry).toHaveBeenCalledOnce();
        }
      } finally {
        unmount();
      }
    },
  );

  it.each(['failed', 'refresh-failed', 'paused', 'refreshing'] as const)(
    'preserves the effective selection and all populated panels while fleet is %s',
    async (status) => {
      const retry = vi.fn();
      scienceMocks.vehicle.mockReturnValue({
        ...oneCarFleet,
        vehiclesState: deriveDataState({
          data: status === 'failed' ? undefined : oneCarFleet.vehicles,
          error: status === 'failed' || status === 'refresh-failed' ? new Error('Fleet lookup failed') : null,
          fetchStatus: status === 'paused' ? 'paused' : status === 'refreshing' ? 'fetching' : 'idle',
          isFetching: status === 'refreshing',
          refetch: retry,
        }),
      });
      const { unmount } = renderPage();
      try {
        expect(screen.queryByRole('link', { name: 'Set up TeslaSync' })).not.toBeInTheDocument();
        for (const domain of ['electrochem', 'thermal', 'weather', 'tires', 'notebook'] as const) {
          expect(screen.getByTestId(`science-${domain}`)).toBeInTheDocument();
          expect(scienceMocks[domain].mock.calls.at(-1)?.[0].vehicleId).toBe('1');
        }
        expect(oneCarFleet.setVehicleId).not.toHaveBeenCalled();
        if (status !== 'refreshing') {
          const user = (await import('@testing-library/user-event')).default.setup();
          await user.click(screen.getByRole('button', { name: status === 'failed' ? /retry/i : 'Refresh' }));
          expect(retry).toHaveBeenCalledOnce();
        }
      } finally {
        unmount();
      }
    },
  );

  it.each([
    '/science?tab=evidence&tag=a&tag=b#science-thermal',
    '/science?vehicle_id=999&days=30&start=2026-09-01T03:00:00%2B03:00&end=2026-09-08T03:00:00%2B03:00&tab=evidence#science-thermal',
  ])('copies the effective vehicle and absolute query window without changing preferences: %s', async (route) => {
    const user = (await import('@testing-library/user-event')).default.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    scienceMocks.vehicle.mockReturnValue({ ...oneCarFleet, vehicleId: 42 });
    const preferences = structuredClone(settingsMock);
    const { unmount } = renderPage(route);
    try {
      await user.click(screen.getByRole('button', { name: 'Copy link to this view' }));
      expect(writeText).toHaveBeenCalledOnce();
      const copied = new URL(writeText.mock.calls[0][0]);
      const original = new URL(route, window.location.origin);
      const effectiveScope = scienceMocks.thermal.mock.calls.at(-1)?.[0];
      expect(copied.pathname).toBe('/science');
      expect(copied.hash).toBe(original.hash);
      expect(copied.searchParams.get('vehicle_id')).toBe('42');
      expect(copied.searchParams.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(copied.searchParams.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(copied.searchParams.has('start')).toBe(false);
      expect(copied.searchParams.has('end')).toBe(false);
      expect(Date.parse(effectiveScope.end)).toBeGreaterThan(Date.parse(effectiveScope.start));
      for (const key of ['tab', 'tag', 'days']) {
        expect(copied.searchParams.getAll(key)).toEqual(original.searchParams.getAll(key));
      }
      expect(settingsMock).toEqual(preferences);
      for (const domain of ['electrochem', 'thermal', 'weather', 'tires', 'notebook'] as const) {
        expect(scienceMocks[domain]).toHaveBeenLastCalledWith(effectiveScope);
        expect(screen.getByTestId(`science-${domain}`)).toBeInTheDocument();
      }

      await user.click(screen.getByTestId('header-science-range'));
      await user.click(screen.getByRole('button', { name: 'Copy link to this view' }));
      const updated = new URL(writeText.mock.calls[1][0]);
      const updatedScope = scienceMocks.thermal.mock.calls.at(-1)?.[0];
      expect(updated.searchParams.get('from')).toBe('2026-09-01');
      expect(updated.searchParams.get('to')).toBe('2026-09-30');
      expect(Date.parse(updatedScope.end) - Date.parse(updatedScope.start)).toBe(30 * 24 * 3600 * 1000);
      expect(updated.searchParams.get('vehicle_id')).toBe('42');
      expect(updated.searchParams.getAll('tag')).toEqual(original.searchParams.getAll('tag'));
      expect(updated.searchParams.get('tab')).toBe('evidence');
      expect(settingsMock).toEqual(preferences);
    } finally {
      unmount();
      writeText.mockRestore();
    }
  });

  it('exposes every science table column in mobile details and keeps the drive link keyboard reachable', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    const bounds = vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(() => new DOMRect(0, 0, 375, 500));
    const report = electrochem();
    report.pulse_ir = [{ ...report.ir_points[0], context: 'charging_pulse' }];
    scienceMocks.electrochem.mockReturnValue(queryState({ data: report }));
    const { unmount } = renderPage();
    try {
      const battery = screen.getByTestId('science-electrochem');
      const frames = battery.querySelectorAll('[data-mobile-table]');
      expect(frames).toHaveLength(5);
      const cases = [
        { frame: frames[0], labels: ['Observed', 'SOC', 'Pack voltage', 'Rest dwell', 'Temperature', 'Direction'], value: 'discharge_rest' },
        { frame: frames[1], labels: ['Observed', 'Pack IR (mΩ)', 'Current step', 'Temperature', 'Context'], value: 'drive_step' },
        { frame: frames[2], labels: ['Observed', 'Pack IR (mΩ)', 'Current step', 'Temperature', 'Context'], value: 'charging_pulse' },
        { frame: frames[3], labels: ['SOC bin', 'Temp bin', 'n', 'Mean OCV (V)', 'Slope V/%'], value: 'unknown' },
        { frame: frames[4], labels: ['Temp bin', 'SOC bin', 'n charge', 'n discharge', 'ΔV (V)'], value: 'unknown' },
        { frame: screen.getByTestId('science-thermal').querySelector('[data-mobile-table]'), labels: ['Park start', 'Fit', 'Samples', 'Cooldown τ', '95% CI for τ', 'R²', 'Residual RMSE', 'Fitted ambient', 'Solar input'], value: 'pack_cooldown' },
        { frame: screen.getByTestId('science-weather').querySelector('[data-mobile-table]'), labels: ['Drive', 'Start', 'Temperature', 'Wind', 'Air density', 'Precipitation', 'Session energy / distance', 'Residual'], value: 'kg/m³' },
      ];
      for (const { frame, labels, value } of cases) {
        expect(frame).not.toBeNull();
        if (!(frame instanceof HTMLElement)) throw new Error('Science mobile table is missing');
        const trigger = within(frame).getAllByRole('button', { name: 'Quick view' })[0];
        trigger.focus();
        await user.keyboard('{Enter}');
        const dialog = screen.getByRole('dialog');
        expect(Array.from(dialog.querySelectorAll('dt'), (field) => field.textContent)).toEqual(labels);
        expect(dialog).toHaveTextContent(value);
        if (labels[0] === 'Drive') {
          const link = within(dialog).getByRole('link', { name: '#7' });
          expect(link).toHaveAttribute('href', '/drives/7');
          expect(link).toHaveClass('min-h-11', 'min-w-11');
          link.focus();
          expect(link).toHaveFocus();
        }
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
      }
    } finally {
      unmount();
      bounds.mockRestore();
    }
  });

  it('retains desktop columns and original pagination when mobile details are enabled', () => {
    const bounds = vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(() => new DOMRect(0, 0, 1280, 500));
    const { unmount } = renderPage();
    try {
      expect(document.querySelector('[data-mobile-table]')).not.toBeInTheDocument();
      expect(within(screen.getByTestId('science-thermal')).getAllByRole('columnheader')).toHaveLength(9);
      expect(within(screen.getByTestId('science-weather')).getAllByRole('columnheader')).toHaveLength(8);
      expect(screen.getByTestId('science-weather').querySelector('a[href="/drives/7"]')).toBeInTheDocument();
    } finally {
      unmount();
      bounds.mockRestore();
    }
  });

  it('exports all matching loaded thermal rows before mobile load-more, not just the first page', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    const exports = await import('@/lib/csvExport');
    const download = vi.spyOn(exports, 'downloadJSON').mockImplementation(() => {});
    const bounds = vi.spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(() => new DOMRect(0, 0, 375, 500));
    const report = thermal();
    report.fits = Array.from({ length: 12 }, (_, index) => ({
      ...report.fits[0],
      start: `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
    }));
    scienceMocks.thermal.mockReturnValue(queryState({ data: report }));
    const { unmount } = renderPage();
    try {
      const panel = screen.getByTestId('science-thermal');
      expect(within(panel).getAllByRole('button', { name: 'Quick view' })).toHaveLength(10);
      const more = within(panel).getByRole('button', { name: 'Load 2 more' });
      await user.click(within(panel).getAllByRole('button', { name: 'Export list' })[0]);
      await user.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
      expect(download).toHaveBeenCalledOnce();
      const rows = download.mock.calls[0][1];
      expect(rows).toHaveLength(12);
      if (!Array.isArray(rows)) throw new Error('Expected loaded-row JSON export');
      expect(Object.keys(rows[0])).toEqual(['start', 'kind', 'samples', 'tau', 'interval', 'r2', 'rmse', 'ambient', 'solar']);
      await user.click(more);
      expect(within(panel).getAllByRole('button', { name: 'Quick view' })).toHaveLength(12);
    } finally {
      unmount();
      bounds.mockRestore();
      download.mockRestore();
    }
  });

  it.each([
    ['user', 'America/Los_Angeles'],
    ['vehicle', 'Asia/Tokyo'],
    ['utc', 'UTC'],
  ])('formats science dates in %s mode and updates locale without changing raw evidence or query scope', async (mode, timezone) => {
    const { fireEvent } = await import('@testing-library/react');
    settingsMock.tz_display_default = mode;
    settingsMock.timezone_user = 'America/Los_Angeles';
    scienceMocks.vehicle.mockReturnValue({
      ...oneCarFleet, vehicle: { ...oneCarFleet.vehicle, timezone: 'Asia/Tokyo' },
    });
    const reports = {
      electrochem: electrochem(), thermal: thermal(), weather: weather(),
      tires: tires(), notebook: notebook(),
    };
    reports.electrochem.ocv_points.push({
      ...reports.electrochem.ocv_points[0], at: '2026-09-03T00:00:00Z',
    });
    const originalReports = structuredClone(reports);
    const loadedAt = Date.parse('2026-09-08T00:30:00Z');
    for (const domain of ['electrochem', 'thermal', 'weather', 'tires', 'notebook'] as const) {
      scienceMocks[domain].mockReturnValue(queryState({ data: reports[domain], dataUpdatedAt: loadedAt }));
    }
    const start = '2026-08-31T15:00:00.000Z';
    const end = '2026-09-07T15:00:00.000Z';
    const { rerenderPage } = renderPage('/science?from=2026-09-01&to=2026-09-07');
    fireEvent.click(screen.getByText(/electrochem · Rest voltage maps SOC/));

    const formatted = (value: string | number) => new Intl.DateTimeFormat(settingsMock.locale, {
      timeZone: timezone, year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(value)).replace(/\s+/g, ' ');
    const assertDates = () => {
      expect(screen.getByRole('group', { name: 'Window' })).toHaveTextContent(
        `${formatted(start)} → ${formatted(end)}`,
      );
      const battery = screen.getByTestId('science-electrochem');
      expect(battery).toHaveTextContent(formatted(reports.electrochem.ocv_points[0].at));
      expect(battery).toHaveTextContent(formatted(reports.electrochem.ir_points[0].at));
      for (const name of ['Rest-end pack voltage over the window', 'Pack resistance over the window']) {
        const chart = screen.getByLabelText(name);
        expect(chart.querySelector('.recharts-xAxis')).toHaveTextContent(
          formatted(name.startsWith('Rest') ? reports.electrochem.ocv_points[0].at : reports.electrochem.ir_points[0].at),
        );
      }
      expect(screen.getByTestId('science-thermal')).toHaveTextContent(formatted(reports.thermal.fits[0].start));
      expect(screen.getByTestId('science-weather')).toHaveTextContent(formatted(reports.weather.points[0].at));
      expect(screen.getByTestId('science-notebook')).toHaveTextContent(
        `${formatted(reports.notebook.entries[0].start)} → ${formatted(reports.notebook.entries[0].end)}`,
      );
      // Scope/freshness moved off the brief faces into the drawer headers.
      const overviewBrief = screen.getByTestId('science-evidence-brief');
      fireEvent.click(within(overviewBrief).getByRole('button', { name: 'Review details' }));
      const overviewDrawer = screen.getByRole('dialog');
      const overviewHeader = overviewDrawer.querySelector('[data-drawer-header]');
      if (!(overviewHeader instanceof HTMLElement)) throw new Error('Review drawer header is missing');
      expect(overviewHeader).toHaveTextContent(
        `${formatted(start)} → ${formatted(end)}`,
      );
      // (The overview never repeats per-domain load times when states are
      // plain success -- 'Independent reports…' in the header; the load time
      // is pinned via the electrochem header below.)
      fireEvent.keyDown(overviewDrawer, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      const electrochemBrief = screen.getByTestId('science-electrochem-brief');
      fireEvent.click(within(electrochemBrief).getByRole('button', { name: 'Review details' }));
      const electrochemDrawer = screen.getByRole('dialog');
      const electrochemHeader = electrochemDrawer.querySelector('[data-drawer-header]');
      if (!(electrochemHeader instanceof HTMLElement)) throw new Error('Review drawer header is missing');
      expect(electrochemHeader).toHaveTextContent(`Report loaded ${formatted(loadedAt)}`);
      fireEvent.keyDown(electrochemDrawer, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    };
    assertDates();
    settingsMock.locale = 'de-DE';
    rerenderPage();
    assertDates();
    for (const domain of ['electrochem', 'thermal', 'weather', 'tires', 'notebook'] as const) {
      for (const [scope] of scienceMocks[domain].mock.calls) {
        expect(scope).toEqual({ vehicleId: '1', start, end });
      }
    }
    expect(reports).toEqual(originalReports);
  });

  it('updates both electrochemistry chart paints from the saved palette without changing evidence or window choice', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const report = electrochem();
    report.ocv_points.push({ ...report.ocv_points[0], at: '2026-09-03T00:00:00Z', ocv_pack_v: 405 });
    const originalReport = structuredClone(report);
    scienceMocks.electrochem.mockReturnValue(queryState({ data: report }));
    renderPage();

    const charts = [
      screen.getByLabelText('Rest-end pack voltage over the window'),
      screen.getByLabelText('Pack resistance over the window'),
    ];
    const paths = charts.map((chart) => chart.querySelector('.recharts-area-curve'));
    for (const path of paths) {
      expect(path).toHaveAttribute('stroke', CHART_COLORS_CB_SAFE[0]);
    }
    const originalPaths = paths.map((path) => path?.getAttribute('d'));

    settingsMock.chart_palette = 'neon';
    fireEvent.click(screen.getByTestId('header-science-range'));
    for (const [index, chart] of charts.entries()) {
      const path = chart.querySelector('.recharts-area-curve');
      expect(path).toHaveAttribute('stroke', CHART_COLORS_NEON[0]);
      expect(path).toHaveAttribute('d', originalPaths[index]!);
    }
    expect(settingsMock.chart_palette).toBe('neon');
    expect(Date.parse(scienceMocks.thermal.mock.calls.at(-1)![0].end) - Date.parse(scienceMocks.thermal.mock.calls.at(-1)![0].start)).toBe(30 * 86400_000);
    expect(report).toEqual(originalReport);
    const panel = screen.getByTestId('science-electrochem');
    expect(panel).toHaveTextContent('405.00 V');
    expect(panel).toHaveTextContent('52.00 mΩ');
    expect(panel).toHaveTextContent('discharge_rest');
    expect(panel).toHaveTextContent('drive_step');
  });

  it('keeps existing panel shells and all source anchors during independent failures', () => {
    scienceMocks.thermal.mockReturnValue(queryState({
      data: undefined, isPending: true, isSuccess: false, fetchStatus: 'fetching',
    }));
    scienceMocks.tires.mockReturnValue(queryState({
      data: undefined, error: new Error('TPMS unavailable'), isError: true, isSuccess: false,
    }));
    renderPage();
    for (const id of ['overview', 'electrochem', 'thermal', 'weather', 'tires', 'notebook']) {
      expect(screen.getByTestId(`science-${id}`).querySelector('[data-print-card]')).toBeInTheDocument();
    }
    const tire = screen.getByTestId('science-tires');
    expect(within(tire).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(tire).not.toHaveTextContent('0 kPa');
    expect(screen.getByTestId('science-electrochem')).toHaveTextContent('Rest-voltage evidence');
    expect(screen.getByTestId('science-weather').querySelector('a[href="/drives/7"]')).toBeInTheDocument();
  });
  it('uses each existing brief as the sole summary surface without duplicating its heading or trust metadata', async () => {
    const { fireEvent } = await import('@testing-library/react');
    renderPage();
    for (const [section, briefId, title] of [
      ['overview', 'evidence', 'Evidence at a glance'],
      ['electrochem', 'electrochem', 'Battery electrochemistry (pack-equivalent)'],
      ['weather', 'weather', 'Weather coupling (correlation)'],
      ['tires', 'tires', 'Tire / contact mechanics'],
    ]) {
      const panel = screen.getByTestId(`science-${section}`);
      const brief = screen.getByTestId(`science-${briefId}-brief`);
      expect(within(panel).getAllByRole('heading', { name: title, exact: true })).toHaveLength(1);
      expect(panel.querySelector('[data-print-card] [data-print-card]')).toBeNull();
      expect(panel.querySelector('[data-card]')).toBeNull();
      fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
      const drawer = screen.getByRole('dialog', { name: `${title} details` });
      // Scope/freshness live in the drawer header, not on the brief face.
      const drawerHeader = drawer.querySelector('[data-drawer-header]');
      if (!(drawerHeader instanceof HTMLElement)) throw new Error('Review drawer header is missing');
      expect(drawerHeader).toHaveTextContent('Vehicle 1');
      expect(drawerHeader).toHaveTextContent(section === 'overview' ? 'Independent reports' : 'Report loaded');
      expect(drawer).toHaveTextContent('Historical inputs and derived fits');
      fireEvent.click(within(drawer).getAllByRole('button', { name: 'Close', exact: true })[0]);
    }
  });
  it('renders all five domain panels with data', async () => {
    const { fireEvent } = await import('@testing-library/react');
    renderPage();
    const overviewBrief = screen.getByTestId('science-evidence-brief');
    // Counts render as face tiles; the prose measures live in the drawer's
    // per-domain groups with the inspect anchors.
    for (const [label, value] of [
      ['rest points', '1'], ['Resistance steps', '2'], ['Thermal fits', '1'],
      ['Weather matches', '1'], ['Tire evidence', '4'], ['Analysis records', '1'],
    ]) {
      const tile = within(overviewBrief).getByText(label).closest('[data-operational-metric]');
      expect(tile?.querySelector('[data-operational-value]')).toHaveTextContent(value);
    }
    fireEvent.click(within(overviewBrief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('group', { name: 'rest points' }))
      .toHaveTextContent('1 rest points · 2 resistance steps');
    expect(within(drawer).getByRole('group', { name: 'Thermal fits' }))
      .toHaveTextContent('1 qualified cooldown fits');
    expect(within(drawer).getByRole('group', { name: 'Weather matches' }))
      .toHaveTextContent('1 drives joined to archive weather');
    expect(within(drawer).getByRole('group', { name: 'Tire evidence' }))
      .toHaveTextContent('4 of 4 corners reported');
    expect(within(drawer).getByRole('group', { name: 'Analysis records' }))
      .toHaveTextContent('1 of 1 rows with a result');
    expect(drawer.querySelectorAll('a[href^="#science-"]')).toHaveLength(5);
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    for (const testId of ['science-electrochem', 'science-thermal', 'science-weather', 'science-tires', 'science-notebook']) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
    for (const id of ['electrochem', 'thermal', 'weather', 'tires', 'notebook']) {
      expect(document.getElementById(`science-${id}`)).toBeInTheDocument();
    }
    const windowControls = screen.getByRole('group', { name: 'Window' });
    expect(within(windowControls).queryByRole('button')).not.toBeInTheDocument();
    const scope = scienceMocks.thermal.mock.calls.at(-1)![0];
    expect(Date.parse(scope.end)-Date.parse(scope.start)).toBe(7*86400_000);

  });

  it('exposes observed inputs, fit diagnostics, and linked source drives', () => {
    scienceMocks.electrochem.mockReturnValue(queryState({ data: electrochem({
      pulse_ir: [{ at: '2026-09-02T03:00:00Z', ir_pack_ohm: 0.07, temp_c: 19, soc_pct: 62, delta_i_a: 25, delta_v_v: 1.75, dt_s: 5, context: 'charge_step' }],
    }) }));
    renderPage();
    const battery = screen.getByTestId('science-electrochem');
    expect(battery).toHaveTextContent('Rest-voltage evidence');
    expect(battery).toHaveTextContent('400.00 V');
    expect(battery).toHaveTextContent('50.00 mΩ');
    expect(battery).toHaveTextContent('1 charging pulse steps');
    expect(battery).toHaveTextContent('70.00 mΩ');
    const thermalPanel = screen.getByTestId('science-thermal');
    expect(thermalPanel).toHaveTextContent('R²');
    expect(thermalPanel).toHaveTextContent('0.99');
    expect(thermalPanel).toHaveTextContent('Residual RMSE');
    const weatherPanel = screen.getByTestId('science-weather');
    expect(weatherPanel).toHaveTextContent('1.225 kg/m³');
    expect(weatherPanel).toHaveTextContent('Session energy / distance');
    expect(weatherPanel.querySelector('a[href="/drives/7"]')).toBeInTheDocument();
    // Unknown correlations omit their tiles (never zeroed) with a counted
    // drawer explanation; the fit guide stays on the face.
    expect(weatherPanel).toHaveTextContent('Pearson r requires at least five');
    assertOperationalMetricUnavailable(screen.getByTestId('science-weather-brief'), 'r(density, residual)');
    assertOperationalMetricUnavailable(screen.getByTestId('science-weather-brief'), 'r(wind, residual)');
  });

  it('allows the full supported 30-day window without hiding any report', async () => {
    const { fireEvent } = await import('@testing-library/react');
    renderPage();
    fireEvent.click(screen.getByTestId('header-science-range'));
    expect(Date.parse(scienceMocks.thermal.mock.calls.at(-1)![0].end) - Date.parse(scienceMocks.thermal.mock.calls.at(-1)![0].start)).toBe(30 * 86400_000);
    expect(screen.getByTestId('science-overview')).toBeInTheDocument();
    for (const id of ['electrochem', 'thermal', 'weather', 'tires', 'notebook']) {
      expect(document.getElementById(`science-${id}`)).toBeInTheDocument();
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
    // The unknown throughput omits its tile (never zeroed) with a counted
    // drawer explanation; the 'Throughput: Unknown' caption fed the old tile.
    assertOperationalMetricUnavailable(screen.getByTestId('science-aging-brief'), 'Throughput');
  });

  it('keeps empty domains visible and provides working retry actions', async () => {
    const { fireEvent, within } = await import('@testing-library/react');
    const retry = vi.fn();
    scienceMocks.electrochem.mockReturnValue(queryState({ data: null, refetch: retry }));
    renderPage();
    const panel = screen.getByTestId('science-electrochem');
    expect(panel.textContent).toMatch(/No fit inputs/);
    assertOperationalBriefDisclosure(screen.getByTestId('science-evidence-brief'), 'Limited evidence');
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
    assertOperationalBriefDisclosure(screen.getByTestId('science-evidence-brief'), 'Cached · refresh failed');
    const retainedTile = within(screen.getByTestId('science-evidence-brief'))
      .getByText('rest points').closest('[data-operational-metric]');
    expect(retainedTile?.querySelector('[data-operational-value]')).toHaveTextContent('1');
    expect(screen.getByLabelText('Pack resistance over the window')).toBeInTheDocument();
  });

  it.each(['electrochem', 'thermal', 'weather', 'tires', 'notebook'] as const)(
    'distinguishes active loading, first paused %s acquisition, empty success and recovery',
    async (domain) => {
      const { fireEvent } = await import('@testing-library/react');
      const retry = vi.fn();
      scienceMocks[domain].mockReturnValue(queryState({
        data: undefined, dataUpdatedAt: 0, isPending: true, isSuccess: false,
        status: 'pending', fetchStatus: 'fetching', isFetching: true, refetch: retry,
      }));
      const { rerenderPage } = renderPage();
      const panel = screen.getByTestId(`science-${domain}`);
      expect(within(panel).getByRole('status', { name: /^Loading / })).toBeInTheDocument();
      expect(panel).not.toHaveTextContent('No requested source');

      scienceMocks[domain].mockReturnValue(queryState({
        data: undefined, dataUpdatedAt: 0, isPending: true, isSuccess: false,
        status: 'pending', fetchStatus: 'paused', refetch: retry,
      }));
      rerenderPage();
      // Briefed domains surface pause in the drawer badge; brief-less
      // domains (thermal, notebook) keep the panel-body notice.
      if (domain === 'thermal' || domain === 'notebook') {
        expect(panel).toHaveTextContent('Refresh paused');
      } else {
        assertOperationalBriefDisclosure(
          screen.getByTestId(`science-${domain}-brief`),
          'Refresh paused',
        );
      }
      expect(panel).toHaveTextContent('No requested source has returned usable data yet.');
      expect(panel.querySelector('[aria-busy="true"]')).toBeNull();
      expect(panel).not.toHaveTextContent('No fit inputs');
      expect(panel).not.toHaveTextContent('Cached');
      expect(panel).not.toHaveTextContent('Service unavailable');
      expect(panel).not.toHaveTextContent('offline');
      expect(panel).not.toHaveTextContent('Failed to load');
      // The paused domain omits its overview tile (never zeroed); the pause
      // marker lives in the overview drawer's badge.
      const overviewLabels = {
        electrochem: 'rest points', thermal: 'Thermal fits', weather: 'Weather matches',
        tires: 'Tire evidence', notebook: 'Analysis records',
      } as const;
      const overviewBrief = screen.getByTestId('science-evidence-brief');
      assertOperationalMetricUnavailable(overviewBrief, overviewLabels[domain]);
      assertOperationalBriefDisclosure(overviewBrief, 'Refresh paused');
      fireEvent.click(within(panel).getByRole('button', { name: /^Retry unavailable sources:/ }));
      expect(retry).toHaveBeenCalledOnce();
      expect(screen.getByTestId(domain === 'electrochem' ? 'science-thermal' : 'science-electrochem'))
        .toHaveTextContent(domain === 'electrochem' ? 'Lumped capacity.' : 'Rest-voltage evidence');
      scienceMocks[domain].mockReturnValue(queryState({ data: null }));
      rerenderPage();
      expect(panel).toHaveTextContent('No fit inputs in this window.');
      expect(panel).not.toHaveTextContent('Refresh paused');

      const reports = { electrochem: electrochem(), thermal: thermal(), weather: weather(), tires: tires(), notebook: notebook() };
      scienceMocks[domain].mockReturnValue(queryState({ data: reports[domain] }));
      rerenderPage();
      // Brief descriptions (honesty) live in the drawer for briefed domains.
      if (domain === 'thermal' || domain === 'notebook') {
        expect(panel).toHaveTextContent(reports[domain].honesty);
      } else {
        const domainBrief = screen.getByTestId(`science-${domain}-brief`);
        fireEvent.click(within(domainBrief).getByRole('button', { name: 'Review details' }));
        const honestyDrawer = screen.getByRole('dialog');
        expect(honestyDrawer).toHaveTextContent(reports[domain].honesty);
        fireEvent.keyDown(honestyDrawer, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      }
      expect(panel).not.toHaveTextContent('No requested source');
    },
  );

  it('recovers all first paused reports to successful empty reports and genuine zero measurements', () => {
    const domains = ['electrochem', 'thermal', 'weather', 'tires', 'notebook'] as const;
    for (const domain of domains) {
      scienceMocks[domain].mockReturnValue(queryState({
        data: undefined, dataUpdatedAt: 0, isPending: true, isSuccess: false,
        status: 'pending', fetchStatus: 'paused',
      }));
    }
    const { rerenderPage } = renderPage();
    const brief = screen.getByTestId('science-evidence-brief');
    expect(brief).not.toHaveAttribute('aria-busy');
    assertOperationalBriefDisclosure(brief, 'Refresh paused');
    expect(brief).not.toHaveTextContent('Cached');
    expect(screen.queryByTestId('stale-refresh-warning')).toBeNull();

    scienceMocks.electrochem.mockReturnValue(queryState({ data: electrochem({ ocv_points: [], ir_points: [] }) }));
    scienceMocks.thermal.mockReturnValue(queryState({ data: thermal({ fits: [] }) }));
    scienceMocks.weather.mockReturnValue(queryState({ data: weather({ points: [], rain_n: 0, dry_n: 0, wind_r: 0 }) }));
    scienceMocks.tires.mockReturnValue(queryState({ data: tires({ imbalance_kpa: 0, extra_wh: 0, underinflation_frac: 0 }) }));
    scienceMocks.notebook.mockReturnValue(queryState({ data: notebook({ entries: [] }) }));
    rerenderPage();
    expect(screen.queryByText('No requested source has returned usable data yet.')).toBeNull();
    expect(brief).not.toHaveTextContent('Refresh paused');
    // Genuine zeros stay numeric on the face tiles.
    const restTile = within(brief).getByText('rest points').closest('[data-operational-metric]');
    expect(restTile?.querySelector('[data-operational-value]')).toHaveTextContent('0');
    const resistanceTile = within(brief).getByText('Resistance steps').closest('[data-operational-metric]');
    expect(resistanceTile?.querySelector('[data-operational-value]')).toHaveTextContent('0');
    expect(screen.getByTestId('science-thermal')).toHaveTextContent('No park cooldown');
    expect(screen.getByTestId('science-notebook')).toHaveTextContent('No notebook rows');
    for (const [briefId, metric] of [['weather', 'wind-correlation'], ['tires', 'extra-rolling']]) {
      expect(screen.getByTestId(`science-${briefId}-brief`)
        .querySelector(`[data-operational-metric="${metric}"]`))
        .toHaveAttribute('data-value-state', 'value');
    }
  });

  it.each(['electrochem', 'thermal', 'weather', 'tires', 'notebook'] as const)(
    'retains %s evidence through refresh failure and removes the warning on recovery',
    async (domain) => {
      const reports = { electrochem: electrochem(), thermal: thermal(), weather: weather(), tires: tires(), notebook: notebook() };
      const report = reports[domain];
      scienceMocks[domain].mockReturnValue(queryState({
        data: report, isError: true, isSuccess: false, error: new Error('refresh failed'),
      }));
      const { rerenderPage } = renderPage();
      const panel = screen.getByTestId(`science-${domain}`);
      expect(within(panel).getByTestId('stale-refresh-warning')).toBeInTheDocument();
      assertOperationalBriefDisclosure(screen.getByTestId('science-evidence-brief'), 'Cached · refresh failed');
      if (domain === 'thermal' || domain === 'notebook') {
        expect(panel).toHaveTextContent(report.honesty);
      } else {
        const retainBrief = screen.getByTestId(`science-${domain}-brief`);
        const { fireEvent: click } = await import('@testing-library/react');
        click.click(within(retainBrief).getByRole('button', { name: 'Review details' }));
        const retainDrawer = screen.getByRole('dialog');
        expect(retainDrawer).toHaveTextContent(report.honesty);
        click.keyDown(retainDrawer, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      }
      scienceMocks[domain].mockReturnValue(queryState({ data: report }));
      rerenderPage();
      expect(within(panel).queryByTestId('stale-refresh-warning')).toBeNull();
      expect(screen.getByTestId('science-overview')).not.toHaveTextContent('Cached · refresh failed');
      // Recovery swaps the overview badge back to available.
      assertOperationalBriefDisclosure(screen.getByTestId('science-evidence-brief'), 'Evidence available');
      if (domain === 'thermal' || domain === 'notebook') {
        expect(panel).toHaveTextContent(report.honesty);
      } else {
        const recoveredBrief = screen.getByTestId(`science-${domain}-brief`);
        const { fireEvent: press } = await import('@testing-library/react');
        press.click(within(recoveredBrief).getByRole('button', { name: 'Review details' }));
        const recoveredDrawer = screen.getByRole('dialog');
        expect(recoveredDrawer).toHaveTextContent(report.honesty);
        press.keyDown(recoveredDrawer, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      }
    },
  );

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
    // Loading/fatal domains omit their tiles (never zeroed); the partial
    // state lives in the overview drawer's badge with a counted explanation.
    const overview = screen.getByTestId('science-evidence-brief');
    assertOperationalMetricUnavailable(overview, 'Thermal fits');
    assertOperationalMetricUnavailable(overview, 'Tire evidence');
    assertOperationalBriefDisclosure(overview, 'Some reports unavailable', { contains: true });
  });

  it('renders the notebook entry with n, method, and honesty', async () => {
    const { fireEvent } = await import('@testing-library/react');
    renderPage();
    const panel = screen.getByTestId('science-notebook');
    expect(panel.textContent).toMatch(/n=4/);
    fireEvent.click(screen.getByText(/electrochem · Rest voltage maps SOC/));
    expect(panel.textContent).toMatch(/Rest voltage maps SOC/);
    expect(panel.textContent).toMatch(/rest_ocv_binned/);
    expect(panel).toHaveTextContent('Signals used: PackVoltage');
    expect(panel).toHaveTextContent('Fit residual (mean / RMSE): unknown / unknown');
    expect(panel).toHaveTextContent('Generated record: electrochem.ocv:1:2026');
  });

  it('shows metric and imperial pressures at the unit boundary', () => {
    renderPage();
    expect(screen.getByTestId('science-tires').textContent).toMatch(/bar/);
  });

  it('preserves notebook parameter identities, values, and intervals in shared semantic tables', async () => {
    const data = notebook();
    data.entries[0].parameters = { raw_case_Field: 1.23456, source: 'Tesla API Identity', omitted: null };
    data.entries[0].ci = { low: -2, high: 0 };
    scienceMocks.notebook.mockReturnValue(queryState({ data }));
    const { fireEvent } = await import('@testing-library/react');
    renderPage();
    fireEvent.click(screen.getByText(/electrochem · Rest voltage maps SOC/));

    const parameters = screen.getByRole('table', { name: 'Parameters' });
    expect(within(parameters).getAllByRole('rowheader')).toHaveLength(2);
    expect(within(parameters).getByRole('rowheader', { name: 'raw_case_Field' })).toBeInTheDocument();
    expect(parameters).toHaveTextContent('1.235');
    expect(parameters).toHaveTextContent('Tesla API Identity');
    const intervals = screen.getByRole('table', { name: 'Confidence intervals' });
    expect(within(intervals).getAllByRole('rowheader')).toHaveLength(2);
    expect(within(intervals).getByRole('rowheader', { name: 'high' }).closest('tr')).toHaveTextContent('0');
    expect(screen.getByTestId('science-notebook')).toHaveTextContent('Fit.');
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

  it('does not crash when Go encodes empty slices as null', async () => {
    scienceMocks.electrochem.mockReturnValue(queryState({
      data: electrochem({
        ocv_points: null as unknown as ScienceElectrochem['ocv_points'],
        ocv_bins: null as unknown as ScienceElectrochem['ocv_bins'],
        hysteresis: null as unknown as ScienceElectrochem['hysteresis'],
        ir_points: null as unknown as ScienceElectrochem['ir_points'],
        pulse_ir: null as unknown as ScienceElectrochem['pulse_ir'],
      }),
    }));
    scienceMocks.thermal.mockReturnValue(queryState({
      data: thermal({ fits: null as unknown as ScienceThermal['fits'] }),
    }));
    scienceMocks.weather.mockReturnValue(queryState({
      data: weather({ points: null as unknown as ScienceWeather['points'] }),
    }));
    scienceMocks.notebook.mockReturnValue(queryState({
      data: notebook({ entries: null as unknown as ScienceNotebook['entries'] }),
    }));
    renderPage();
    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
    // Sample counts live in the drawer's per-metric groups.
    const { fireEvent: sliceFire } = await import('@testing-library/react');
    const sliceBrief = screen.getByTestId('science-electrochem-brief');
    sliceFire.click(within(sliceBrief).getByRole('button', { name: 'Review details' }));
    const sliceDrawer = screen.getByRole('dialog');
    expect(within(sliceDrawer).getByRole('group', { name: 'rest points' })).toHaveTextContent('n=0');
    expect(within(sliceDrawer).getByRole('group', { name: 'Resistance steps' })).toHaveTextContent('n=0');
    sliceFire.keyDown(sliceDrawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('science-thermal').textContent).toMatch(/No park cooldown/);
    expect(screen.getByTestId('science-notebook').textContent).toMatch(/No notebook rows/);
    // Null slices collapse to genuine zero tiles (never blanked, never NaN).
    const nullBrief = screen.getByTestId('science-evidence-brief');
    const nullRest = within(nullBrief).getByText('rest points').closest('[data-operational-metric]');
    expect(nullRest?.querySelector('[data-operational-value]')).toHaveTextContent('0');
    const nullResistance = within(nullBrief).getByText('Resistance steps').closest('[data-operational-metric]');
    expect(nullResistance?.querySelector('[data-operational-value]')).toHaveTextContent('0');
  });

  it('does not substitute zero for missing weather and thermal measurements', () => {
    scienceMocks.thermal.mockReturnValue(queryState({ data: thermal({ fits: [{
      start: '2026-09-02T00:00:00Z', end: '2026-09-02T06:00:00Z', kind: 'pack_cooldown',
      tau_s: null, tau_ci95_low: null, tau_ci95_high: null, t_inf_c: null, n: 2,
      r2: null, residual_rmse_c: null, solar_unknown: true, unknown: true,
    }] }) }));
    scienceMocks.weather.mockReturnValue(queryState({ data: weather({
      points: [{ ...weather().points[0], temp_c: null, density_kg_m3: null, residual_wh_per_m: null, session_wh_per_m: null }],
    }) }));
    renderPage();
    expect(screen.getByTestId('science-thermal')).toHaveTextContent('unknown');
    const zeroBrief = screen.getByTestId('science-evidence-brief');
    const zeroThermal = within(zeroBrief).getByText('Thermal fits').closest('[data-operational-metric]');
    expect(zeroThermal?.querySelector('[data-operational-value]')).toHaveTextContent('0');
    expect(screen.getByTestId('science-weather')).toHaveTextContent('unknown');
    expect(screen.getByTestId('science-weather')).not.toHaveTextContent('0.000 kg/m³');
  });

  it('renders the pack-IR chart as real SVG', () => {
    const { container } = renderPage();
    expect(screen.getByLabelText('Pack resistance over the window')).toBeInTheDocument();
    const chart = screen.getByTestId('science-electrochem').querySelector('.recharts-wrapper svg');
    expect(chart).not.toBeNull();
    expect(container.querySelector('.recharts-area-curve')).not.toBeNull();
  });

  it('renders every genuine summary through the real brief and typed raw bridge', () => {
    const bridge = vi.spyOn(operationalMetrics, 'useOperationalMetrics');
    renderPage();
    for (const id of ['evidence', 'electrochem', 'arrhenius', 'aging', 'weather', 'tires']) {
      const brief = screen.getByTestId(`science-${id}-brief`);
      expect(brief).toHaveAttribute('data-operational-brief');
      expect(within(brief).getByRole('button', { name: 'Review details' })).toBeInTheDocument();
    }
    const rawMetrics = bridge.mock.calls.flatMap(([metrics]) => metrics);
    expect(rawMetrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ occurrenceId: 'front-left', metricId: 'pressure', rawValue: 290 }),
      expect.objectContaining({ occurrenceId: 'extra-rolling', metricId: 'energy', rawValue: 35 }),
      expect.objectContaining({ occurrenceId: 'rest-duration', metricId: 'duration', rawValue: 144000 }),
      expect.objectContaining({ occurrenceId: 'throughput', metricId: 'energy', rawValue: 50000 }),
      expect.objectContaining({ occurrenceId: 'underinflation', metricId: 'percent', rawValue: 0.07 * 100 }),
      expect.objectContaining({ occurrenceId: 'density-correlation', metricId: 'ratio', rawValue: null }),
    ]));
    expect(screen.getByTestId('science-tires-brief').querySelector('[data-operational-metric="front-left"]'))
      .toHaveAttribute('data-value-state', 'value');
    assertOperationalMetricUnavailable(
      screen.getByTestId('science-weather-brief'),
      'r(density, residual)',
    );
    bridge.mockRestore();
  });

  it('opens the real science review drawer with model caveats and no fabricated confidence score', async () => {
    const { fireEvent } = await import('@testing-library/react');
    renderPage();
    const brief = screen.getByTestId('science-tires-brief');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Tire / contact mechanics details' });
    expect(drawer).toHaveTextContent('Model sensitivity, not a confidence interval');
    expect(drawer).toHaveTextContent('Extra rolling energy is model sensitivity, not measured loss.');
    expect(drawer).toHaveTextContent('placard');
    expect(drawer).toHaveTextContent('Front left');
    expect(drawer).toHaveTextContent('2.9 bar');
    expect(drawer).toHaveTextContent('Not scored');
    expect(drawer).toHaveTextContent('Historical inputs and derived fits');
    expect(drawer).not.toHaveTextContent('100%');
  });

  it('retains uncertainty, specialist quantities and signed correlation without turning them into health scores', async () => {
    const report = electrochem();
    report.arrhenius = {
      ...report.arrhenius, ea_j_per_mol: 12345.678,
      ea_ci95_low: 10000, ea_ci95_high: 15000, unknown: false,
    };
    report.aging = { ...report.aging, proxy_slope_wh_per_day: -125.75, proxy_n: 8, unknown: false };
    report.capacity_proxy_unknown = false;
    report.capacity_proxy_wh = 70000;
    scienceMocks.electrochem.mockReturnValue(queryState({ data: report }));
    scienceMocks.weather.mockReturnValue(queryState({ data: weather({ density_r: -0.6, wind_r: 0 }) }));
    renderPage();
    const arrhenius = screen.getByTestId('science-arrhenius-brief');
    expect(arrhenius).toHaveTextContent('12,345.68 J/mol');
    const { fireEvent: openDrawer } = await import('@testing-library/react');
    openDrawer.click(within(arrhenius).getByRole('button', { name: 'Review details' }));
    const arrheniusDrawer = screen.getByRole('dialog');
    // Interval context lives in the drawer's per-metric groups.
    expect(within(arrheniusDrawer).getByRole('group', { name: 'Ea' }))
      .toHaveTextContent('10,000.00…15,000.00 J/mol');
    openDrawer.keyDown(arrheniusDrawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const aging = screen.getByTestId('science-aging-brief');
    expect(aging).toHaveTextContent('-125.75 Wh/day');
    openDrawer.click(within(aging).getByRole('button', { name: 'Review details' }));
    const agingDrawer = screen.getByRole('dialog');
    expect(within(agingDrawer).getByRole('group', { name: 'Proxy slope' }))
      .toHaveTextContent('n=8.00');
    openDrawer.keyDown(agingDrawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const weatherBrief = screen.getByTestId('science-weather-brief');
    const density = weatherBrief.querySelector('[data-operational-metric="density-correlation"]');
    const wind = weatherBrief.querySelector('[data-operational-metric="wind-correlation"]');
    expect(density).toHaveAttribute('data-value-state', 'value');
    expect(density?.querySelector('[data-operational-value]')).toHaveTextContent('-0.60');
    expect(wind).toHaveAttribute('data-value-state', 'value');
    expect(wind?.querySelector('[data-operational-value]')).toHaveTextContent('0.00');
    expect(density?.querySelector('[data-operational-value]')).not.toHaveTextContent('%');
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.click(within(arrhenius).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Temperature dependence of pack resistance details' });
    expect(drawer).toHaveTextContent('10,000.00…15,000.00 J/mol');
    expect(drawer).toHaveTextContent('Not scored');
  });

  it('keeps retained raw readings and distinct per-source trust while a refresh is paused', () => {
    scienceMocks.tires.mockReturnValue(queryState({
      data: tires(), fetchStatus: 'paused', isFetching: false,
    }));
    renderPage();
    const tiresBrief = screen.getByTestId('science-tires-brief');
    assertOperationalBriefDisclosure(tiresBrief, 'Cached · refresh paused');
    expect(tiresBrief.querySelector('[data-operational-metric="front-left"]'))
      .toHaveAttribute('data-value-state', 'value');
    assertOperationalBriefDisclosure(screen.getByTestId('science-evidence-brief'), 'Cached · refresh paused');
    assertOperationalBriefDisclosure(screen.getByTestId('science-electrochem-brief'), 'Evidence available');
    expect(screen.getByLabelText('Pack resistance over the window')).toBeInTheDocument();
  });

  it.each([
    { label: 'negative', low: -150.25, high: -100.75, slope: -125.5, interval: '-150.25…-100.75' },
    { label: 'positive fractional', low: 0.25, high: 0.75, slope: 0.5, interval: '0.25…0.75' },
    { label: 'crossing zero', low: -0.25, high: 0.75, slope: 0.25, interval: '-0.25…0.75' },
    { label: 'measured zero', low: 0, high: 0, slope: 0, interval: '0.00…0.00' },
  ])('shows the reported $label interval in source units with numeric evidence', async ({ low, high, slope, interval }) => {
    const report = electrochem();
    report.arrhenius = { ...report.arrhenius, ea_j_per_mol: slope, ea_ci95_low: low, ea_ci95_high: high, unknown: false };
    report.aging = {
      ...report.aging, proxy_slope_wh_per_day: slope, proxy_ci95_low: low,
      proxy_ci95_high: high, proxy_n: 8, holdout_rmse_wh: 250, unknown: false,
    };
    scienceMocks.electrochem.mockReturnValue(queryState({ data: report }));
    renderPage();
    const { fireEvent: drawerFire } = await import('@testing-library/react');
    const arrhenius = screen.getByTestId('science-arrhenius-brief');
    drawerFire.click(within(arrhenius).getByRole('button', { name: 'Review details' }));
    const arrheniusIntervalDrawer = screen.getByRole('dialog');
    // Interval + n context lives in the drawer's per-metric groups.
    expect(within(arrheniusIntervalDrawer).getByRole('group', { name: 'Ea' }))
      .toHaveTextContent(`CI: ${interval} J/mol`);
    drawerFire.keyDown(arrheniusIntervalDrawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const aging = screen.getByTestId('science-aging-brief');
    drawerFire.click(within(aging).getByRole('button', { name: 'Review details' }));
    const agingIntervalDrawer = screen.getByRole('dialog');
    expect(within(agingIntervalDrawer).getByRole('group', { name: 'Proxy slope' }))
      .toHaveTextContent(`CI: ${interval} Wh/day`);
    expect(within(agingIntervalDrawer).getByRole('group', { name: 'Proxy slope' }))
      .toHaveTextContent('n=8.00');
    drawerFire.keyDown(agingIntervalDrawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(aging.querySelector('[data-operational-metric="proxy-slope"]')).toHaveAttribute('data-value-state', 'value');
    expect(aging).toHaveTextContent(`${slope.toFixed(2)} Wh/day`);
    expect(aging).toHaveTextContent('Assumed reference capacity');
    expect(aging).toHaveTextContent('75.0 kWh');
    expect(aging).toHaveTextContent('holdout RMSE');
    expect(aging).toHaveTextContent('0.3 kWh');
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.click(within(aging).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Aging exposure and capacity-proxy trend details' });
    expect(drawer).toHaveTextContent(`CI: ${interval} Wh/day`);
    expect(drawer).toHaveTextContent('Not scored');
    expect(drawer).not.toHaveTextContent('100%');
  });

  it.each([
    { label: 'missing both bounds', low: null, high: null },
    { label: 'missing lower bound', low: null, high: 0 },
    { label: 'missing upper bound', low: 0, high: null },
    { label: 'omitted bounds', low: undefined, high: undefined },
    { label: 'NaN lower bound', low: Number.NaN, high: 0 },
    { label: 'infinite upper bound', low: 0, high: Number.POSITIVE_INFINITY },
    { label: 'negative infinite lower bound', low: Number.NEGATIVE_INFINITY, high: 0 },
    { label: 'reversed bounds', low: 1, high: -1 },
    { label: 'non-numeric lower bound', low: '0', high: 1 },
  ])('keeps $label unknown rather than inventing a zero interval', ({ low, high }) => {
    const report = electrochem();
    Object.assign(report.arrhenius, { ea_ci95_low: low, ea_ci95_high: high });
    Object.assign(report.aging, { proxy_ci95_low: low, proxy_ci95_high: high, proxy_slope_wh_per_day: null });
    scienceMocks.electrochem.mockReturnValue(queryState({ data: report }));
    renderPage();
    // Unusable intervals omit their tiles (never zeroed) with a counted
    // drawer explanation; the unknown-interval caption fed the old tiles.
    assertOperationalMetricUnavailable(screen.getByTestId('science-arrhenius-brief'), 'Ea');
    assertOperationalMetricUnavailable(screen.getByTestId('science-aging-brief'), 'Proxy slope');
    for (const id of ['arrhenius', 'aging']) {
      const brief = screen.getByTestId(`science-${id}-brief`);
      expect(brief).not.toHaveTextContent('CI: 0.00…0.00');
      expect(brief).not.toHaveTextContent('NaN');
      expect(brief).not.toHaveTextContent('Infinity');
    }
    const aging = screen.getByTestId('science-aging-brief');
    assertOperationalMetricUnavailable(aging, 'holdout RMSE');
  });

  it('does not turn absent summaries into zero while preserving successful peers and genuine zeros', () => {
    scienceMocks.electrochem.mockReturnValue(queryState({
      data: undefined, isPending: true, status: 'pending', fetchStatus: 'fetching',
    }));
    scienceMocks.weather.mockReturnValue(queryState({ data: weather({ density_r: 0, wind_r: null }) }));
    renderPage();
    const battery = screen.getByTestId('science-electrochem-brief');
    expect(battery).toHaveAttribute('aria-busy', 'true');
    expect(battery.querySelector('[data-operational-value]')).toBeNull();
    const overview = screen.getByTestId('science-evidence-brief');
    expect(overview).not.toHaveAttribute('aria-busy');
    assertOperationalMetricUnavailable(overview, 'rest points');
    expect(overview.querySelector('[data-operational-metric="science-weather"]'))
      .toHaveAttribute('data-value-state', 'value');
    expect(screen.getByTestId('science-weather-brief').querySelector('[data-operational-metric="density-correlation"]'))
      .toHaveAttribute('data-value-state', 'value');
    assertOperationalMetricUnavailable(
      screen.getByTestId('science-weather-brief'),
      'r(wind, residual)',
    );
  });

  it('keeps nullable fit ledgers unknown and exposes invalid readings rather than displaying zero', () => {
    const report = electrochem();
    Object.assign(report, { arrhenius: null, aging: null });
    scienceMocks.electrochem.mockReturnValue(queryState({ data: report }));
    scienceMocks.tires.mockReturnValue(queryState({ data: tires({ fl_kpa: Number.NaN, extra_model_low: null, extra_model_high: null }) }));
    renderPage();
    assertOperationalMetricUnavailable(screen.getByTestId('science-arrhenius-brief'), 'Temperature span');
    assertOperationalMetricUnavailable(screen.getByTestId('science-aging-brief'), 'Throughput');
    // No producer sets the 'invalid' valueState (verified: never in pipeline
    // history), so the NaN reading omits its tile like any unknown -- never
    // zeroed, with a counted drawer explanation. See Report-only findings.
    // (The 'unknown…unknown' range caption fed the old omitted tile.)
    assertOperationalMetricUnavailable(screen.getByTestId('science-tires-brief'), 'Front left');
    expect(screen.getByLabelText('Pack resistance over the window')).toBeInTheDocument();
  });
});

 it('does not query any science panel when the header exceeds its 30-day limit', () => {
  renderPage('/science?from=2026-01-01&to=2026-02-01');
  expect(screen.getByText('Choose a workspace range of at most 30 days to view science evidence.')).toBeVisible();
  for(const domain of ['electrochem','thermal','weather','tires','notebook'] as const) expect(scienceMocks[domain]).not.toHaveBeenCalled();
 });
