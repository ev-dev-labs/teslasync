/**
 * PhysicsLedgerPage — solver contract tests.
 *
 * Strategy mirrors DayLogPage.test.tsx: `usePhysicsLedger` is mocked at
 * the hook boundary with full query state so loading, error, empty, and
 * populated branches are deterministic with no network. `useSettings`
 * renders for real through the file-level mock so `useUnits` converts SI
 * through the real `unitConversion` boundary (km assertions here, mi in
 * the imperial block).
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

const { usePhysicsLedgerMock, useSelectedVehicleMock } = vi.hoisted(() => ({
  usePhysicsLedgerMock: vi.fn(),
  useSelectedVehicleMock: vi.fn(),
}));

vi.mock('@/api/hooks/usePhysicsLedger', () => ({
  usePhysicsLedger: usePhysicsLedgerMock,
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: useSelectedVehicleMock,
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

import PhysicsLedgerPage from './PhysicsLedgerPage';
import type { PhysicsLedger, PhysicsTerm } from '@/api/types';

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

function term(wh: number | null, method = 'test'): PhysicsTerm {
  return wh == null
    ? { value_wh: null, method: 'unknown', unknown: true, missing_signals: ['PackVoltage'] }
    : { value_wh: wh, method, unknown: false };
}

function ledgerResponse(over: Partial<PhysicsLedger> = {}): PhysicsLedger {
  return {
    vehicle_id: 1,
    kind: 'range',
    start: '2026-09-13T12:00:00Z',
    end: '2026-09-14T12:00:00Z',
    dynamics: {
      points: [
        { at: '2026-09-13T12:00:00Z', speed_mps: 20, accel_mps2: 0, force_long_n: 0, power_mech_w: 0, power_pack_w: 8000, friction_brake_w: null, unknown: false },
        { at: '2026-09-13T12:01:00Z', speed_mps: 21, accel_mps2: 0.01, force_long_n: 20, power_mech_w: 420, power_pack_w: 8100, friction_brake_w: null, unknown: false },
      ],
      mass_kg: 2000,
      mass_source: 'configured',
      regen_wh: 120,
      friction_brake_wh: 30,
      unknown: false,
      honesty: 'Regen is pack charge current while moving.',
    },
    drive: {
      measured_wh: term(1650, 'pack_vi_trapezoid'),
      session_wh: 1640,
      reconcile_wh: 10,
      aero_wh: term(900, 'half_rho_cda_v3'),
      rolling_wh: term(500, 'crr_m_g_v'),
      grade_wh: term(null),
      inertial_wh: term(5, 'half_m_delta_v2'),
      accessory_wh: term(120, 'hvac_step_hold'),
      drivetrain_loss_wh: term(150, 'model_drivetrain_eff'),
      predicted_wh: 1675,
      unexplained_wh: -25,
      unexplained_known: true,
      missing_signals: ['elevation'],
      honesty: 'Drive energy from pack power.',
    },
    charge: {
      energy_added_wh: 8200,
      session_wh: 8200,
      wall_wh: term(9100, 'ac_step_hold'),
      efficiency_pct: 90.1,
      efficiency_known: true,
      precondition_wh: term(null),
      dwell_complete_s: 300,
      unplugged: true,
      unknown: false,
      honesty: 'Only Disconnected is unplug.',
    },
    park: {
      duration_s: 3600,
      avg_watts_w: 45,
      energy_wh: 45,
      sentry_wh: term(null),
      cabin_overheat_wh: term(null),
      precondition_wh: term(null),
      quiet_pack_wh: term(45, 'all_quiet_window'),
      plugged_at_limit: false,
      trusted: true,
      unknown: false,
      honesty: 'Drain while Gear=P only.',
    },
    thermal: {
      pack_min_c: 18, pack_max_c: 32, pack_start_c: 19, pack_end_c: 31,
      inside_c: 21, outside_c: 15, heat_vs_power_r: 0.72, unknown: false,
      honesty: 'Temperatures as recorded.',
    },
    range: {
      rated_m: 400000, est_m: 380000, ideal_m: 420000, energy_wh: 60000,
      implied_wh_per_m: 0.16, spread_m: 40000, disagree: true, unknown: false,
      honesty: 'Never picks a true range.',
    },
    tires: {
      fl_kpa: 290, fr_kpa: 292, rl_kpa: 288, rr_kpa: 291,
      imbalance_kpa: 4, unknown: false, honesty: 'TPMS as recorded.',
    },
    epochs: [
      { firmware: '2026.24.3', measured_wh: 1650, predicted_wh: 1675, unexplained_wh: -25, sample_count: 120, honesty: 'Correlation.' },
    ],
    unknown_intervals: [
      { started_at: '2026-09-13T13:00:00Z', ended_at: '2026-09-13T13:05:00Z', duration_s: 300, reason: 'gap' },
    ],
    unknown_hours: 0.083,
    black_box: [
      { at: '2026-09-14T11:58:30Z', speed_mps: 0, power_pack_w: 300, force_long_n: 0 },
      { at: '2026-09-14T11:59:30Z', speed_mps: 0, power_pack_w: 250, force_long_n: 0 },
    ],
    contradictions: [],
    markers: [{ at: '2026-09-13T12:00:00Z', kind: 'drive', id: 7, edge: 'start' }],
    truncated: false,
    missing_signals: ['elevation'],
    honesty: 'Predicted vs measured.',
    ...over,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/tesla-only/ledger']}>
        <PhysicsLedgerPage />
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
  useSelectedVehicleMock.mockReturnValue(oneCarFleet);
  usePhysicsLedgerMock.mockReturnValue(queryState({ data: ledgerResponse() }));
});

describe('PhysicsLedgerPage', () => {
  it('renders all eleven domain panels with data', () => {
    renderPage();
    for (const testId of [
      'ledger-dynamics', 'ledger-drive', 'ledger-charge', 'ledger-park',
      'ledger-thermal', 'ledger-range', 'ledger-tires', 'ledger-epochs',
      'ledger-unknown', 'ledger-blackbox', 'ledger-markers',
    ]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
  });

  it('shows unknown terms honestly instead of zero', () => {
    renderPage();
    // Grade is unknown in the fixture; the row must say unknown, never 0.
    const drive = screen.getByTestId('ledger-drive');
    expect(drive.textContent).toMatch(/unknown/);
    expect(drive.textContent).not.toMatch(/Grade[^]*\b0 Wh\b/);
  });

  it('renders the residual, reconcile, and honesty strings', () => {
    renderPage();
    expect(screen.getByTestId('ledger-drive').textContent).toMatch(/Unexplained residual/);
    expect(screen.getByTestId('ledger-drive').textContent).toMatch(/reconcile/);
  });

  it('shows truncated and contradiction badges when set', () => {
    usePhysicsLedgerMock.mockReturnValue(
      queryState({ data: ledgerResponse({ truncated: true, contradictions: ['gear_P_with_speed'] }) }),
    );
    renderPage();
    expect(screen.getByTestId('ledger-summary').textContent).toMatch(/Sample cap hit/);
    expect(screen.getByTestId('ledger-summary').textContent).toMatch(/gear_P_with_speed/);
  });

  it('renders skeletons while loading', () => {
    usePhysicsLedgerMock.mockReturnValue(
      queryState({ data: undefined, isPending: true, isSuccess: false, status: 'pending', fetchStatus: 'fetching' }),
    );
    const { container } = renderPage();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('renders the error state with retry', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const refetch = vi.fn();
    usePhysicsLedgerMock.mockReturnValue(
      queryState({ data: undefined, error: new Error('boom'), isError: true, isSuccess: false, status: 'error', refetch }),
    );
    renderPage();
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry).toBeInTheDocument();
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalled();
  });

  it('shows metric distances in km mode', () => {
    renderPage();
    expect(screen.getByTestId('ledger-range').textContent).toMatch(/km/);
  });

  it('shows imperial distances in mi mode', () => {
    settingsMock.unit_of_length = 'mi';
    renderPage();
    expect(screen.getByTestId('ledger-range').textContent).toMatch(/mi/);
  });

  it('renders charts for dynamics and black box', () => {
    const { container } = renderPage();
    expect(screen.getByLabelText('Pack power and speed over the window')).toBeInTheDocument();
    expect(screen.getByLabelText('Force, power, and speed in the last 90 seconds')).toBeInTheDocument();
    // Real recharts SVG (only the zero-size container is mocked for jsdom).
    const svgs = container.querySelectorAll('.recharts-wrapper svg');
    expect(svgs.length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('.recharts-area-curve')).not.toBeNull();
  });
});
