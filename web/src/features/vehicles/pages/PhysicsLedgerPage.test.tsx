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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    tz_display_default: 'vehicle',
    chart_palette: 'neon',
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
      locale: settingsMock.locale,
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

vi.mock('@/lib/csvExport', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/csvExport')>(),
  downloadCSV: vi.fn(),
  downloadJSON: vi.fn(),
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
import { downloadCSV, downloadJSON } from '@/lib/csvExport';
import { columnLayoutStorageKey, resetColumnLayout, setColumnLayout } from '@/lib/columnOrderStore';
import { formatDateTime } from '@/lib/dateFormat';
import { chartTokens } from '@/lib/tokens';
import {
  LEDGER_ACCENT, LEDGER_SECONDARY, LEDGER_TERTIARY, asList, downsample,
} from '../components/physics-ledger/helpers';

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

function renderPage(initialEntry = '/tesla-only/ledger') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<PhysicsLedgerPage />, { wrapper: Wrapper });
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
  settingsMock.locale = 'en-US';
  settingsMock.timezone_user = '';
  settingsMock.tz_display_default = 'vehicle';
  useSelectedVehicleMock.mockReturnValue(oneCarFleet);
  usePhysicsLedgerMock.mockReturnValue(queryState({ data: ledgerResponse() }));
});

afterEach(() => {
  resetColumnLayout('physics-ledger:epochs');
  vi.restoreAllMocks();
});

describe('PhysicsLedgerPage', () => {
  it('uses ordered chart presentation roles without changing source identity or saved IDs', () => {
    const savedPalette = settingsMock.chart_palette;
    setColumnLayout('physics-ledger:epochs', { order: ['samples', 'firmware'], hidden: ['predicted'] });
    const storageKey = columnLayoutStorageKey('physics-ledger:epochs');
    const savedColumns = window.localStorage.getItem(storageKey);
    expect([LEDGER_ACCENT, LEDGER_SECONDARY, LEDGER_TERTIARY]).toEqual(
      chartTokens.series.slice(0, 3),
    );
    const ledger = ledgerResponse();
    const points = ledger.dynamics!.points;
    const original = JSON.stringify(ledger);
    expect(asList(points)).toEqual(points);
    const displayed = downsample(points, 500);
    displayed.forEach((point, index) => expect(point).toBe(points[index]));
    usePhysicsLedgerMock.mockReturnValue(queryState({ data: ledger }));
    renderPage();
    expect(screen.getByLabelText('Pack power and speed over the window')).toBeInTheDocument();
    expect(screen.getByTestId('ledger-drive')).toHaveTextContent('Unexplained residual');
    expect(JSON.stringify(ledger)).toBe(original);
    expect(settingsMock.chart_palette).toBe(savedPalette);
    expect(window.localStorage.getItem(storageKey)).toBe(savedColumns);
  });

  it('reactively formats the analysis window and brief scope without changing UTC query bounds', () => {
    const start = '2026-09-13T12:00:00.000Z';
    const end = '2026-09-14T12:00:00.000Z';
    useSelectedVehicleMock.mockReturnValue({
      ...oneCarFleet, vehicle: { ...oneCarFleet.vehicle, timezone: 'America/Los_Angeles' },
    });
    const { rerender } = renderPage(
      `/tesla-only/ledger?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
    );
    const assertWindow = (locale: string, tz: string) => {
      const label = `${formatDateTime(start, { locale, tz })} → ${formatDateTime(end, { locale, tz })}`;
      expect(within(screen.getByRole('group', { name: 'Window' })).getByText(label)).toBeInTheDocument();
      expect(screen.getByTestId('ledger-summary')).toHaveTextContent(label);
      expect(usePhysicsLedgerMock).toHaveBeenLastCalledWith({ vehicleId: '1', start, end });
    };
    assertWindow('en-US', 'America/Los_Angeles');

    settingsMock.locale = 'de-DE';
    useSelectedVehicleMock.mockReturnValue({
      ...oneCarFleet, vehicle: { ...oneCarFleet.vehicle, timezone: 'Asia/Tokyo' },
    });
    rerender(<PhysicsLedgerPage />);
    assertWindow('de-DE', 'Asia/Tokyo');

    settingsMock.tz_display_default = 'user';
    settingsMock.timezone_user = 'Europe/Berlin';
    rerender(<PhysicsLedgerPage />);
    assertWindow('de-DE', 'Europe/Berlin');

    settingsMock.tz_display_default = 'utc';
    rerender(<PhysicsLedgerPage />);
    assertWindow('de-DE', 'UTC');
    expect(screen.getByTestId('ledger-unknown')).toHaveTextContent('gap');
    expect(screen.getByTestId('ledger-markers')).toHaveTextContent('drive');
    expect(screen.getByLabelText('Pack power and speed over the window')).toBeInTheDocument();
  });

  it('exports matching loaded epochs as canonical rawJSON with SI, nulls, signs and window evidence', async () => {
    const first = ledgerResponse().epochs![0];
    const kept = { ...first, firmware: 'Kept', measured_wh: 0, predicted_wh: null, unexplained_wh: -25.125 };
    const ledger = ledgerResponse({
      epochs: [first, kept], truncated: true, contradictions: ['gear_P_with_speed'],
    });
    setColumnLayout('physics-ledger:epochs', { order: ['samples', 'firmware'], hidden: ['predicted', 'unexplained'] });
    usePhysicsLedgerMock.mockReturnValue(queryState({ data: ledger }));
    renderPage();
    const panel = screen.getByTestId('ledger-epochs');
    expect(panel).toHaveTextContent('rawJSON (SI, Wh) / displayCSV (kWh)');
    fireEvent.change(within(panel).getByRole('searchbox', { name: 'Search loaded rows' }), {
      target: { value: 'Kept' },
    });
    await waitFor(() => expect(within(panel).queryByText(first.firmware)).not.toBeInTheDocument());
    fireEvent.click(within(panel).getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
    await waitFor(() => expect(downloadJSON).toHaveBeenCalledOnce());
    const [filename, payload] = vi.mocked(downloadJSON).mock.calls[0];
    expect(filename).toContain('rawJSON');
    expect(JSON.parse(JSON.stringify(payload))).toEqual({
      representation: 'rawJSON', scope: 'matchingLoaded',
      vehicle_id: ledger.vehicle_id, kind: ledger.kind, start: ledger.start, end: ledger.end,
      truncated: true, missing_signals: ledger.missing_signals,
      unknown_intervals: ledger.unknown_intervals, unknown_hours: ledger.unknown_hours,
      contradictions: ledger.contradictions, honesty: ledger.honesty, epochs: [kept],
    });
    expect(JSON.stringify(payload)).not.toContain('fullHistory');
    expect(ledger.epochs).toEqual([first, kept]);
  });

  it('exports labeled displayCSV in visible-column order while retaining epoch and window provenance', async () => {
    const first = ledgerResponse().epochs![0];
    const ledger = ledgerResponse({ epochs: [
      first, { ...first, firmware: 'Unknown', measured_wh: 0, predicted_wh: null, unexplained_wh: null },
    ] });
    setColumnLayout('physics-ledger:epochs', {
      order: ['unexplained', 'firmware', 'predicted', 'measured', 'samples'], hidden: ['samples'],
    });
    usePhysicsLedgerMock.mockReturnValue(queryState({ data: ledger }));
    renderPage();
    fireEvent.click(within(screen.getByTestId('ledger-epochs')).getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as CSV' }));
    await waitFor(() => expect(downloadCSV).toHaveBeenCalledOnce());
    const [filename, csv] = vi.mocked(downloadCSV).mock.calls[0];
    expect(filename).toContain('displayCSV');
    const [header, populated, unknown] = csv.split('\r\n');
    expect(header).toMatch(/^Unexplained \(kWh\),Firmware,Predicted \(kWh\),Measured \(kWh\),epoch_honesty,/);
    expect(header).not.toContain('Samples');
    expect(populated).toMatch(/^'-0\.0 kWh,2026\.24\.3,1\.7 kWh,1\.7 kWh,/);
    expect(populated).toContain('Correlation.,displayCSV,matchingLoaded,1,range,2026-09-13T12:00:00Z,2026-09-14T12:00:00Z');
    expect(unknown).toMatch(/^Unknown,Unknown,Unknown,0\.0 kWh,/);
    expect(csv).toContain('gap');
    expect(downloadJSON).not.toHaveBeenCalled();
  });

  it('preserves all five epoch columns and source order on desktop', () => {
    const first = ledgerResponse().epochs![0];
    usePhysicsLedgerMock.mockReturnValue(queryState({
      data: ledgerResponse({ epochs: [first, { ...first, firmware: '2026.24.4', sample_count: 121 }] }),
    }));
    renderPage();
    const table = within(screen.getByTestId('ledger-epochs')).getByRole('table');
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual([
      'Firmware', 'Measured', 'Predicted', 'Unexplained', 'Samples',
    ]);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('2026.24.3');
    expect(rows[1]).toHaveTextContent('2026.24.4');
    expect(within(rows[0]).getAllByRole('cell')).toHaveLength(5);
    expect(rows[0]).toHaveTextContent('120');
  });

  it('opens complete epoch details by keyboard at mobile width and restores focus', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 375, height: 100, top: 0, left: 0, right: 375, bottom: 100,
      x: 0, y: 0, toJSON: () => ({}),
    });
    const first = ledgerResponse().epochs![0];
    usePhysicsLedgerMock.mockReturnValue(queryState({
      data: ledgerResponse({ epochs: [first, {
        ...first, firmware: '2026.24.4', measured_wh: 0, predicted_wh: null,
        unexplained_wh: null, sample_count: 0,
      }] }),
    }));
    const user = userEvent.setup();
    renderPage();
    const panel = screen.getByTestId('ledger-epochs');
    expect(panel.querySelector('[data-mobile-table]')).not.toBeNull();
    const triggers = within(panel).getAllByRole('button', { name: 'Quick view' });
    triggers[0].focus();
    await user.keyboard('{Enter}');
    const details = screen.getByRole('dialog');
    for (const label of ['Firmware', 'Measured', 'Predicted', 'Unexplained', 'Samples']) {
      expect(within(details).getByText(label)).toBeInTheDocument();
    }
    expect(details).toHaveTextContent('2026.24.3');
    expect(details).toHaveTextContent('120');
    expect(details).toHaveTextContent(/1\.7\s*kWh/);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(triggers[0]).toHaveFocus());
    triggers[1].focus();
    await user.keyboard(' ');
    const unknownDetails = screen.getByRole('dialog');
    expect(unknownDetails).toHaveTextContent('2026.24.4');
    expect(within(unknownDetails).getAllByText(/unknown/i)).toHaveLength(2);
    expect(unknownDetails).toHaveTextContent(/0(?:\.0)?\s*kWh/);
  });

  it('reviews the real ledger brief without dropping truncation and contradiction evidence', () => {
    usePhysicsLedgerMock.mockReturnValue(queryState({
      data: ledgerResponse({ truncated: true, contradictions: ['gear_P_with_speed'] }),
    }));
    renderPage();
    const brief = screen.getByTestId('ledger-summary');
    expect(brief.querySelector('[data-operational-metric="ledger-kind"]')).toHaveAttribute('data-value-state', 'value');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText(/Sample cap hit/)).toBeInTheDocument();
    expect(within(drawer).getByText(/gear_P_with_speed/)).toBeInTheDocument();
    expect(within(drawer).getAllByText('Predicted vs measured.').length).toBeGreaterThan(0);
  });

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

  it('keeps accounting terms, unknown evidence, and the residual in semantic shared tables', () => {
    const ledger = ledgerResponse();
    ledger.drive.measured_wh = term(0, 'recorded_zero');
    usePhysicsLedgerMock.mockReturnValue(queryState({ data: ledger }));
    renderPage();

    const drive = screen.getByRole('table', { name: 'Drive energy ledger' });
    expect(within(drive).getAllByRole('rowheader')).toHaveLength(8);
    const measured = within(drive).getByRole('rowheader', { name: /Measured pack energy/ }).closest('tr')!;
    expect(within(measured).getByRole('cell')).toHaveTextContent(/0(?:\.0+)?\s+(?:kWh|Wh)/);
    const grade = within(drive).getByRole('rowheader', { name: /Grade/ }).closest('tr')!;
    expect(grade).toHaveTextContent('PackVoltage');
    expect(within(grade).getByRole('cell')).toHaveTextContent(/unknown/i);
    expect(within(drive).getByRole('rowheader', { name: 'Unexplained residual' }).closest('tfoot')).not.toBeNull();
    expect(within(screen.getByRole('table', { name: 'Charge physics' })).getAllByRole('rowheader')).toHaveLength(3);
    expect(within(screen.getByRole('table', { name: 'Park / vampire physics' })).getAllByRole('rowheader')).toHaveLength(6);
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

  it('does not crash when Go encodes empty slices and missing nested ledgers as null', () => {
    usePhysicsLedgerMock.mockReturnValue(queryState({
      data: ledgerResponse({
        dynamics: null as unknown as PhysicsLedger['dynamics'],
        drive: null as unknown as PhysicsLedger['drive'],
        charge: null as unknown as PhysicsLedger['charge'],
        park: null as unknown as PhysicsLedger['park'],
        thermal: null as unknown as PhysicsLedger['thermal'],
        range: null as unknown as PhysicsLedger['range'],
        tires: null as unknown as PhysicsLedger['tires'],
        epochs: null as unknown as PhysicsLedger['epochs'],
        unknown_intervals: null as unknown as PhysicsLedger['unknown_intervals'],
        black_box: null as unknown as PhysicsLedger['black_box'],
        markers: null as unknown as PhysicsLedger['markers'],
      }),
    }));
    renderPage();
    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('ledger-dynamics')).toBeInTheDocument();
    expect(screen.getByTestId('ledger-drive').textContent).toMatch(/No drive interval/);
    expect(screen.getByTestId('ledger-unknown')).toHaveTextContent('Unknown');
    expect(screen.getByTestId('ledger-unknown')).not.toHaveTextContent(/Full coverage/);
    expect(screen.getByTestId('ledger-blackbox').textContent).toMatch(/Fewer than two samples/);
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

  it('embeds actual motion series with accessible signed values and null gaps without duplicate chrome', () => {
    const ledger = ledgerResponse();
    ledger.black_box = [
      { at: '2026-09-14T11:58:30Z', speed_mps: 20, power_pack_w: -8000, force_long_n: -200 },
      { at: '2026-09-14T11:59:00Z', speed_mps: null, power_pack_w: null, force_long_n: null },
      { at: '2026-09-14T11:59:30Z', speed_mps: 0, power_pack_w: 0, force_long_n: 0 },
    ];
    usePhysicsLedgerMock.mockReturnValue(queryState({ data: ledger }));
    renderPage();
    for (const [panelId, labels] of [
      ['ledger-dynamics', ['Pack power (kW)', 'Speed']],
      ['ledger-blackbox', ['Pack power (kW)', 'Speed', 'Force (N)']],
    ] as const) {
      const panel = screen.getByTestId(panelId);
      expect(within(panel).getAllByRole('figure')).toHaveLength(labels.length);
      for (const label of labels) {
        const frame = within(panel).getByRole('figure', { name: label });
        expect(frame.querySelector('.recharts-area')).not.toBeNull();
        expect(frame.querySelector('.recharts-wrapper svg')).not.toBeNull();
        expect(frame.querySelector('[style*="--chart-height-desktop: 200px"]')).not.toBeNull();
        expect(within(frame).getByRole('table')).toBeInTheDocument();
        expect(within(frame).queryByRole('button')).not.toBeInTheDocument();
        expect(within(frame).getByRole('heading', { name: label })).toHaveClass('sr-only');
      }
    }
    const blackBox = screen.getByTestId('ledger-blackbox');
    for (const [label, negative, zero] of [
      ['Pack power (kW)', /-8(?:\.0+)? kW/, /0(?:\.0+)? kW/],
      ['Speed', /72(?:\.0+)? km\/h/, /0(?:\.0+)? km\/h/],
      ['Force (N)', /-200(?:\.0+)? N/, /0(?:\.0+)? N/],
    ] as const) {
      const table = within(within(blackBox).getByRole('figure', { name: label })).getByRole('table');
      const rows = within(table).getAllByRole('row').slice(1);
      expect(rows).toHaveLength(3);
      expect(rows[0]).toHaveTextContent(negative);
      expect(rows[1]).toHaveTextContent('—');
      expect(rows[2]).toHaveTextContent(zero);
    }
    expect(ledger.black_box[1].power_pack_w).toBeNull();
    expect(ledger.black_box[0].power_pack_w).toBe(-8000);
    const dynamicsTable = within(within(screen.getByTestId('ledger-dynamics'))
      .getByRole('figure', { name: 'Speed' })).getByRole('table');
    expect(within(dynamicsTable).getAllByRole('columnheader').map(header => header.textContent)).toEqual([
      'Time', 'Speed (speed_mps)', 'accel_mps2', 'force_long_n', 'power_mech_w',
      'power_pack_w', 'friction_brake_w', 'unknown',
    ]);
    const cells = within(within(dynamicsTable).getAllByRole('row')[2]).getAllByRole('cell');
    expect(cells.map(cell => cell.textContent)).toEqual([
      expect.stringContaining('2026-09-13T12:01:00Z'), expect.stringContaining('21 ('),
      '0.01', '20', '420', '8100', '—', 'false',
    ]);
    expect(screen.queryByText(/Visual series is sampled/)).not.toBeInTheDocument();
  });

  it('keeps all returned motion rows and raw fields in frame tables independently of plotted sampling', () => {
    const points = Array.from({ length: 501 }, (_, index) => ({
      at: new Date(Date.UTC(2026, 8, 14, 11, 0, index)).toISOString(),
      speed_mps: index === 500 ? null : 20.125,
      power_pack_w: index === 500 ? null : -8000.125,
      force_long_n: index === 500 ? null : -200.125,
      latch: index === 500 ? 'unknown' : 'moving',
    }));
    usePhysicsLedgerMock.mockReturnValue(queryState({ data: ledgerResponse({ black_box: points }) }));
    renderPage();
    const panel = screen.getByTestId('ledger-blackbox');
    for (const label of ['Pack power (kW)', 'Speed', 'Force (N)']) {
      const frame = within(panel).getByRole('figure', { name: label });
      expect(within(frame).getByText('Showing 500 of 501 observations for display.')).toBeInTheDocument();
      expect(within(frame).getByText('Visual series is sampled: 500 of 501 observations are rendered.')).toBeInTheDocument();
      const table = within(frame).getByRole('table');
      const rows = within(table).getAllByRole('row').slice(1);
      expect(rows).toHaveLength(501);
      expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual([
        'Time', label === 'Speed' ? 'Speed (speed_mps)' : 'speed_mps',
        label === 'Pack power (kW)' ? 'Pack power (kW) (power_pack_w)' : 'power_pack_w',
        label === 'Force (N)' ? 'Force (N) (force_long_n)' : 'force_long_n', 'latch',
      ]);
      expect(rows[0]).toHaveTextContent('20.125');
      expect(rows[0]).toHaveTextContent('-8000.125');
      expect(rows[0]).toHaveTextContent('-200.125');
      expect(rows[0]).toHaveTextContent('moving');
      expect(within(rows[500]).getAllByRole('cell').map(cell => cell.textContent)).toEqual([
        expect.stringContaining(points[500].at), '—', '—', '—', 'unknown',
      ]);
      expect(frame.querySelector('.recharts-area-curve')).not.toBeNull();
    }
    expect(points[500].power_pack_w).toBeNull();
  });

  it.each([false, true])('does not infer complete coverage from empty intervals (truncated=%s)', (truncated) => {
    usePhysicsLedgerMock.mockReturnValue(queryState({
      data: ledgerResponse({ unknown_intervals: [], unknown_hours: 0, truncated }),
    }));
    renderPage();
    const panel = screen.getByTestId('ledger-unknown');
    expect(panel).toHaveTextContent('No unknown intervals returned; coverage is not established.');
    expect(panel).toHaveTextContent('Unknown hours: 0');
    expect(panel).not.toHaveTextContent(/Full coverage/);
    expect(panel.querySelector('[class*="semantic-success"]')).toBeNull();
    if (truncated) {
      expect(within(panel).getByText(/Sample cap hit/)).toBeInTheDocument();
    } else {
      expect(within(panel).queryByText(/Sample cap hit/)).not.toBeInTheDocument();
    }
  });

  it('keeps absent intervals distinct from an empty returned list while retaining reported hours', () => {
    usePhysicsLedgerMock.mockReturnValue(queryState({
      data: ledgerResponse({ unknown_intervals: null, unknown_hours: 2 }),
    }));
    renderPage();
    const panel = screen.getByTestId('ledger-unknown');
    expect(within(panel).getByText('Unknown')).toBeInTheDocument();
    expect(panel).toHaveTextContent('Unknown hours: 2');
    expect(panel).not.toHaveTextContent(/No unknown intervals returned|Full coverage/);
  });

  it('retains populated unknown intervals, their durations, and capped evidence', () => {
    usePhysicsLedgerMock.mockReturnValue(queryState({ data: ledgerResponse({ truncated: true }) }));
    renderPage();
    const panel = screen.getByTestId('ledger-unknown');
    expect(within(panel).getByText('gap')).toBeInTheDocument();
    // Durations follow the saved duration unit (hours by default): 300 s → 0.1 h.
    expect(panel).toHaveTextContent(/0\.1\s*h/);
    expect(panel).toHaveTextContent(/Unknown hours: 0\.\d+/);
    expect(panel).toHaveTextContent(/Sample cap hit/);
    expect(within(panel).getByRole('table')).toBeInTheDocument();
  });

  it('keeps every shell on acquisition failure without claiming an empty measurement window', () => {
    usePhysicsLedgerMock.mockReturnValue(queryState({
      data: undefined, error: new Error('boom'), isError: true, isSuccess: false, status: 'error',
    }));
    const { container } = renderPage();
    // Twelve domain panels plus their nested summary briefs.
    expect(container.querySelectorAll('[data-testid^="ledger-"]').length).toBeGreaterThanOrEqual(12);
    expect(screen.getAllByText('No requested source has returned usable data yet.')).toHaveLength(12);
    expect(screen.queryByText(/No ledger samples/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('keeps paused initial evidence unresolved without a loading or offline claim', () => {
    usePhysicsLedgerMock.mockReturnValue(queryState({
      data: undefined, isPending: true, isSuccess: false, status: 'pending', fetchStatus: 'paused',
    }));
    const { container } = renderPage();
    // Twelve domain panels plus their nested summary briefs.
    expect(container.querySelectorAll('[data-testid^="ledger-"]').length).toBeGreaterThanOrEqual(12);
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByText(/No ledger samples|device is offline/i)).not.toBeInTheDocument();
    expect(screen.getAllByText('No requested source has returned usable data yet.')).toHaveLength(12);
  });

  it('marks capped evidence partial while retaining all domain panels and raw energy terms', () => {
    const ledger = ledgerResponse({ truncated: true });
    usePhysicsLedgerMock.mockReturnValue(queryState({ data: ledger }));
    const { container } = renderPage();
    expect(container.querySelectorAll('[data-provenance="historical"][data-data-status="partial"]')).toHaveLength(2);
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('Partial data');
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('Sample cap hit — oldest prefix solved');
    // Twelve domain panels plus their nested summary briefs.
    expect(container.querySelectorAll('[data-testid^="ledger-"]').length).toBeGreaterThanOrEqual(12);
    expect(ledger.drive.measured_wh.value_wh).toBe(1650);
    expect(ledger.drive.unexplained_wh).toBe(-25);
    expect(ledger.dynamics.points[1].power_pack_w).toBe(8100);
  });

  it('retains the complete ledger and retry after a failed refresh of capped evidence', () => {
    const refetch = vi.fn();
    usePhysicsLedgerMock.mockReturnValue(queryState({
      data: ledgerResponse({ truncated: true }), error: new Error('refresh failed'),
      isError: true, isSuccess: false, status: 'error', refetch,
    }));
    const { container } = renderPage();
    // Twelve domain panels plus their nested summary briefs.
    expect(container.querySelectorAll('[data-testid^="ledger-"]').length).toBeGreaterThanOrEqual(12);
    const notice = screen.getByTestId('stale-refresh-warning');
    expect(notice).toHaveTextContent('Previously loaded data remains visible while affected sources recover.');
    expect(screen.queryByText('No requested source has returned usable data yet.')).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Drive energy ledger' })).toBeInTheDocument();
    fireEvent.click(within(notice).getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('preserves both URL-backed investigation windows and the selected vehicle scope', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Last 24h' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Last 6h' }));
    expect(screen.getByRole('button', { name: 'Last 6h' })).toHaveAttribute('aria-pressed', 'true');
    const scope = usePhysicsLedgerMock.mock.lastCall?.[0] as {
      vehicleId: string; start: string; end: string;
    };
    expect(scope.vehicleId).toBe('1');
    expect(Date.parse(scope.end) - Date.parse(scope.start)).toBe(6 * 3600 * 1000);
    fireEvent.click(screen.getByRole('button', { name: 'Last 24h' }));
    const restoredScope = usePhysicsLedgerMock.mock.lastCall?.[0] as typeof scope;
    expect(Date.parse(restoredScope.end) - Date.parse(restoredScope.start)).toBe(24 * 3600 * 1000);
  });
});
