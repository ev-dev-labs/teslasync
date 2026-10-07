import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ChargingSession, ChargeTelemetryReading, ChargingTelemetry } from '@/api/types';
import { getFormatterPreferences, setGlobalPrecision } from '@/lib/numberFormat';
import { useChargingSessionDetail, useChargeTelemetry } from '@/api/hooks/useCharging';
import { useVehicle, useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import ChargingDetailPage from '../../pages/ChargingDetailPage';

vi.mock('@/api/hooks/useCharging', () => ({
  useChargingSessionDetail: vi.fn(), useChargeTelemetry: vi.fn(),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicle: vi.fn(), useChargingTelemetryLatest: vi.fn(),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({
  unitPrefs: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'kWh', power: 'kW', duration: 'min', locale: 'en-US' },
  formatEnergy: (raw: number) => `${(raw / 1000).toFixed(2)} kWh`,
  formatPower: (raw: number) => `${(raw / 1000).toFixed(2)} kW`,
}) }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({
  costPerKwh: 0.12, currencySymbol: '$',
  formatCurrency: (raw: number) => `$${raw.toFixed(2)}`,
  formatEnergyCost: (raw: number) => `$${(raw * 0.12).toFixed(2)}`,
}) }));
vi.mock('@/components/layout', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/layout')>(),
  // Preserve real PageLayout/CardGrid/LayoutCard, isolate only the global shell.
  PageContainer: ({ title, children, overflowActions, metadataActions }: {
    title: string; children: ReactNode; overflowActions?: ReactNode; metadataActions?: ReactNode;
  }) => <main><header><h1>{title}</h1>{metadataActions}{overflowActions}</header>{children}</main>,
}));
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  const Pass = ({ children, className }: { children?: ReactNode; className?: string }) =>
    <div className={className}>{children}</div>;
  // Only flatten page entrance wrappers. Shared controls still need the real
  // motion/AnimatePresence exports and their DOM, state and action handling.
  return { ...actual, FadeIn: Pass, StaggerContainer: Pass, StaggerItem: Pass };
});
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ...actual, ...chartTestDoubles,
    ChartTimeRangeProvider: Pass, ResponsiveContainer: Pass,
    useSyncedCursor: () => ({ syncId: 'charging.session', syncMethod: 'value', onMouseMove: vi.fn() }),
    useSyncedReferenceLineX: () => null,
    EmbeddedChart: ({ title, data, children }: {
      title: string; data?: unknown[];
      children?: ReactNode | ((props: { hiddenSeries: { isHidden: () => boolean } }) => ReactNode);
    }) => (
      <figure aria-label={title} data-samples={data?.length ?? 'omitted'}>
        {typeof children === 'function' ? children({ hiddenSeries: { isHidden: () => false } }) : children}
      </figure>
    ),
    LinearGauge: ({ label, value }: { label: string; value: number }) =>
      <output aria-label={label}>{value}</output>,
  };
});
vi.mock('@/components/ai/AIChargingDiagnosis', () => ({
  AIChargingDiagnosis: ({ sessionId }: { sessionId: string }) => <div data-testid="diagnosis-owner">{sessionId}</div>,
}));
vi.mock('../ChargeBillTruthPanel', () => ({
  ChargeBillTruthPanel: ({ session }: { session: ChargingSession }) => <div data-testid="bill-owner">{session.total_energy_added_wh}</div>,
}));
vi.mock('../ChargePhysicsPanel', () => ({
  ChargePhysicsPanel: ({ sessionId }: { sessionId: string }) => <div data-testid="physics-owner">{sessionId}</div>,
}));
vi.mock('../ChargeLedgerCompactPanel', () => ({
  ChargeLedgerCompactPanel: ({ sessionId }: { sessionId: string }) => <div data-testid="ledger-owner">{sessionId}</div>,
}));
vi.mock('../ShareSessionDialog', async () => {
  const { Button } = await import('@/components/ui');
  return {
    ShareSessionDialog: ({ sessionId, open, onClose }: { sessionId: string; open: boolean; onClose: () => void }) =>
      open ? <div role="dialog" aria-label="Share session" data-session-id={sessionId}>
        <Button onClick={onClose}>Close share</Button>
      </div> : null,
  };
});
vi.mock('@/components/feedback', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/feedback')>(),
  LiveStaleDataBanner: () => null,
}));

const session: ChargingSession = {
  id: 42, vehicle_id: 7, started_at: '2026-10-01T10:00:00Z', ended_at: '2026-10-01T11:00:00Z',
  start_soc_pct: 20, end_soc_pct: 80, delta_soc_pct: 60,
  start_odometer_m: null, end_odometer_m: null, start_lat: null, start_lng: null,
  start_place: 'Synthetic test charger', total_energy_added_wh: 50000,
  peak_power_w: 150000, avg_power_w: 100000, cost_decimal: 12.5, cost_currency: 'USD',
  charger_type: 'DC', cable_type: null, startedAt: '2026-10-01T10:00:00Z', duration_min: 60,
};
const reading: ChargeTelemetryReading = {
  session_id: 42, vehicle_id: 7, ts: '2026-10-01T10:15:00Z',
  ac_charging_power_w: null, dc_charging_power_w: null, ac_charging_energy_in_wh: null,
  dc_charging_energy_in_wh: null, charger_voltage_v: null, charger_actual_current_a: null,
  charger_pilot_current_a: null, charger_phases: null, battery_heater_on: null,
  battery_heater_power_w: null, charge_limit_soc_pct: null, charge_request: null,
  fast_charger_type: null, charging_cable_type: null, charge_port_door_open: null,
  charge_port_latch: null, created_at: '2026-10-01T10:15:00Z',
  battery_level: 40, soc: 40, power_w: 120000, energy_added: 10, rated_range: 200000,
  battery_temp: 25, inside_temp: 21, outside_temp: 12, voltage: 400, current_amps: 250,
};
const live: ChargingTelemetry = {
  vehicle_id: 7, ts: '2026-10-01T10:15:00Z', session_id: 42, battery_level: 40,
  battery_range_mi: 320000, charging_state: 'Charging', charger_voltage: 240,
  charger_actual_current: 24.5, charger_power_w: 11000, charger_phases: 3,
  charge_energy_added_wh: 12000, range_added_meters: 45000,
  range_added_meters_per_hour: 30000, charger_pilot_current: 32,
  scheduled_charging_at: null, source: 'synthetic test',
};
function query<T>(data: T, error: Error | null = null, isLoading = false) {
  return {
    data, error, isLoading, isPending: isLoading, isFetching: false,
    isError: error != null, fetchStatus: 'idle' as const,
    dataUpdatedAt: data === undefined ? 0 : Date.now(), refetch: vi.fn(),
  };
}
function mockSession(result: ReturnType<typeof query<ChargingSession | undefined>>) {
  vi.mocked(useChargingSessionDetail).mockReturnValue(result as unknown as ReturnType<typeof useChargingSessionDetail>);
}
function mockTelemetry(result: ReturnType<typeof query<ChargeTelemetryReading[] | undefined>>) {
  vi.mocked(useChargeTelemetry).mockReturnValue(result as unknown as ReturnType<typeof useChargeTelemetry>);
}
function mockLive(result: ReturnType<typeof query<ChargingTelemetry | null | undefined>>) {
  vi.mocked(useChargingTelemetryLatest).mockReturnValue(result as unknown as ReturnType<typeof useChargingTelemetryLatest>);
}
let client: QueryClient;
const originalPrecision = getFormatterPreferences().precision;
beforeEach(() => {
  vi.clearAllMocks();
  setGlobalPrecision(2);
  client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  mockSession(query(session));
  mockTelemetry(query([reading]));
  mockLive(query(live));
  vi.mocked(useVehicle).mockReturnValue(query({ display_name: 'Synthetic vehicle' }) as unknown as ReturnType<typeof useVehicle>);
});
afterEach(() => { cleanup(); client.clear(); setGlobalPrecision(originalPrecision); });
function mount() {
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/charging/42']}>
    <Routes><Route path="/charging/:id" element={<ChargingDetailPage />} /></Routes>
  </MemoryRouter></QueryClientProvider>);
}
function liveValue(label: string) {
  const term = screen.getAllByText(label).find(item => item.tagName === 'DT');
  return term?.closest('div')?.querySelector('dd')?.textContent;
}

describe('real page orchestration with source-isolated specialist/chart doubles', () => {
  it('wires original sources, eight real stats, specialists, four plots and share/back/print actions', () => {
    const { container } = mount();
    expect(useChargingSessionDetail).toHaveBeenCalledWith(42);
    expect(useChargeTelemetry).toHaveBeenCalledWith(42);
    expect(useVehicle).toHaveBeenCalledWith('7');
    expect(useChargingTelemetryLatest).toHaveBeenCalledWith(7);
    expect(container.querySelectorAll('[data-card-grid]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(8);
    expect(screen.getAllByRole('figure')).toHaveLength(4);
    for (const owner of ['diagnosis-owner', 'physics-owner', 'ledger-owner'])
      expect(screen.getByTestId(owner)).toHaveTextContent('42');
    expect(screen.getByTestId('bill-owner')).toHaveTextContent('50000');
    expect(liveValue('Charge Rate')).toBe('30.00 km/h');
    expect(liveValue('Range Added')).toBe('45.00 km');
    expect(screen.getByRole('link', { name: 'Back to charging' })).toHaveAttribute('href', '/charging');
    expect(container.querySelector('[data-print-hide]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('data-session-id', '42');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close share' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('retains all charts, neighbors and live values after session/telemetry/live refresh failures', () => {
    mockSession(query(session, new Error('session refresh failed')));
    mockTelemetry(query([reading], new Error('samples refresh failed')));
    const latest = query(live, new Error('latest refresh failed'));
    mockLive(latest);
    const { container } = mount();
    expect(screen.getAllByRole('figure')).toHaveLength(4);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(8);
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(3);
    expect(liveValue('Range Added')).toBe('45.00 km');
    fireEvent.click(within(screen.getAllByTestId('stale-refresh-warning')[2]!).getByRole('button', { name: 'Refresh' }));
    expect(latest.refetch).toHaveBeenCalledOnce();
  });
  it('isolates fatal telemetry failure, retains summaries and retries the actual telemetry source', () => {
    const failed = query<ChargeTelemetryReading[] | undefined>(undefined, new Error('sample source failed'));
    mockTelemetry(failed);
    const { container } = mount();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(8);
    expect(screen.getAllByRole('figure')).toHaveLength(1);
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(3);
    fireEvent.click(retries[0]!);
    expect(failed.refetch).toHaveBeenCalledOnce();
    expect(screen.getByTestId('ledger-owner')).toBeInTheDocument();
  });
  it.each([true, false])('keeps primary-source outlines for loading=%s without requesting specialists', loading => {
    mockSession(query<ChargingSession | undefined>(undefined, loading ? null : new Error('session failed'), loading));
    mockTelemetry(query<ChargeTelemetryReading[] | undefined>(undefined));
    mockLive(query<ChargingTelemetry | undefined>(undefined));
    const { container } = mount();
    expect(container.querySelectorAll('[data-card-grid]')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Temperature' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Charge Curve' })).toBeInTheDocument();
    expect(screen.queryByTestId('physics-owner')).toBeNull();
    expect(screen.queryByTestId('ledger-owner')).toBeNull();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
  });
  it('distinguishes a live-source fatal failure from authoritative null and keeps history intact', () => {
    const failed = query<ChargingTelemetry | undefined>(undefined, new Error('latest failed'));
    mockLive(failed);
    const { rerender } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(failed.refetch).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('figure')).toHaveLength(4);
    mockLive(query(null));
    rerender(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/charging/42']}>
      <Routes><Route path="/charging/:id" element={<ChargingDetailPage />} /></Routes>
    </MemoryRouter></QueryClientProvider>);
    expect(screen.getByText('No live charging telemetry available.')).toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).toBeNull();
  });
  it('retains inferred/empty telemetry panels and marks only the curve estimated for an AC record', () => {
    mockSession(query({ ...session, charger_type: null, cost_decimal: null, ended_at: null, start_place: null }));
    mockTelemetry(query([]));
    mockLive(query(null));
    const { container } = mount();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(8);
    expect(screen.getByText('(estimated)')).toBeInTheDocument();
    expect(screen.getAllByRole('figure')).toHaveLength(1);
    expect(screen.getByText('No battery level, energy, or range samples were recorded for this session.')).toBeInTheDocument();
    expect(screen.getByText('No battery, cabin, or ambient temperature samples were recorded for this session.')).toBeInTheDocument();
    expect(screen.getByText('No voltage or current samples were recorded for this session.')).toBeInTheDocument();
    expect(screen.getByText('No location recorded for this session.')).toBeInTheDocument();
    expect(screen.getByTestId('bill-owner')).toBeInTheDocument();
  });
  it('preserves all four dense plots while omitting only their capped accessible-table payload', () => {
    const rows = Array.from({ length: 2001 }, () => ({ ...reading }));
    mockTelemetry(query(rows));
    mount();
    const figures = screen.getAllByRole('figure');
    expect(figures).toHaveLength(4);
    for (const figure of figures) expect(figure).toHaveAttribute('data-samples', 'omitted');
    expect(rows).toHaveLength(2001);
    expect(rows[2000]?.power_w).toBe(120000);
  });
});
