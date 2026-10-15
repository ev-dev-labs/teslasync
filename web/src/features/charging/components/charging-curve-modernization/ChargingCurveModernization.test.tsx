/**
 * Authored for parent execution: NOTRUN.
 * Real Router, PageLayout/CardGrid/LayoutCard, StatStrip, useDataState and range
 * state. Specialist echoes test orchestration only, never chart runtime parity.
 */
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ChargingSession } from '@/api/types';
import type { CurvePoint } from '../charging-curve/types';
import { Button } from '@/components/ui';
import { useRangeState } from '@/hooks/useRangeState';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import ChargingCurvePage from '../../pages/ChargingCurvePage';

const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  query: {} as {
    data?: ChargingSession[];
    error?: Error | null;
    isError: boolean;
    isFetching: boolean;
    isLoading: boolean;
    isStale: boolean;
    fetchStatus: 'idle' | 'paused' | 'fetching';
    dataUpdatedAt: number;
    refetch: () => void;
  },
  refetch: vi.fn(),
  queryCall: vi.fn(),
}));

vi.mock('@/api/hooks/useCharging', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/hooks/useCharging')>();
  return { ...actual, useChargingSessionsPaginated: (...args: unknown[]) => {
    h.queryCall(...args);
    return h.query;
  } };
});
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: h.vehicleId, vehicle: null, vehicles: [], setVehicleId: vi.fn() }),
}));
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return { ...actual, FadeIn: ({ children }: { children: ReactNode }) => <>{children}</> };
});
vi.mock('../charging-curve', () => ({
  SessionCurveChart: ({ curveData }: { curveData: CurvePoint[] }) =>
    <div data-testid="curve" data-points={curveData.length} data-first-power={curveData[0]?.power} />,
  SessionDetailPanel: ({ session }: { session: ChargingSession }) =>
    <div data-testid="details" data-session={session.id} />,
  SessionComparisonChart: ({ sessions }: { sessions: ChargingSession[] }) =>
    <div data-testid="comparison" data-ids={sessions.map(session => session.id).join(',')} />,
  ChargerTypeChart: ({ sessions }: { sessions: ChargingSession[] }) =>
    <div data-testid="charger" data-ids={sessions.map(session => session.id).join(',')} />,
  SpeedTrendChart: ({ sessions }: { sessions: ChargingSession[] }) =>
    <div data-testid="speed" data-ids={sessions.map(session => session.id).join(',')} />,
  TimeToChargeSection: ({ sessions }: { sessions: ChargingSession[] }) =>
    <div data-testid="ttc" data-ids={sessions.map(session => session.id).join(',')} />,
}));
vi.mock('@/components/ai/AIChargingCurveFingerprintClustering', () => ({
  AIChargingCurveFingerprintClustering: ({ vehicleId }: { vehicleId?: number }) =>
    <div data-testid="fingerprint" data-vehicle={vehicleId ?? ''} />,
}));
vi.mock('@/components/ai/AIMLChargingCurveClustering', () => ({
  AIMLChargingCurveClustering: ({ vehicleId }: { vehicleId?: number }) =>
    <div data-testid="ml" data-vehicle={vehicleId ?? ''} />,
}));

function session(overrides: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: 101, vehicle_id: 7,
    started_at: '2024-05-01T10:00:00Z', ended_at: '2024-05-01T10:40:00Z',
    start_soc_pct: 20, end_soc_pct: 80, delta_soc_pct: 60,
    start_odometer_m: null, end_odometer_m: null,
    start_lat: null, start_lng: null, start_place: 'Downtown Plaza',
    total_energy_added_wh: 50_000, peak_power_w: 150_000, avg_power_w: 120_000,
    cost_decimal: 12.5, cost_currency: 'USD', charger_type: 'Tesla', cable_type: null,
    live: false, startedAt: '2024-05-01T10:00:00Z', duration_min: 40,
    ...overrides,
  };
}
const dc = session();
const ac = session({
  id: 102, started_at: '2024-05-02T22:00:00Z', ended_at: '2024-05-03T04:00:00Z',
  start_soc_pct: 40, end_soc_pct: 90, total_energy_added_wh: 30_000, peak_power_w: 11_000,
  avg_power_w: null, cost_decimal: 4.25, charger_type: null, start_place: null,
});

function HeaderRangeCommand() {
  const { setRange } = useRangeState();
  return <Button onClick={() => setRange({ start: '2024-06-01', end: '2024-06-30' })}>
    Change workspace range
  </Button>;
}

const clients: QueryClient[] = [];
const preferences = getFormatterPreferences();
function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/charging/curves?from=2024-05-01&to=2024-05-31']}>
        <HeaderRangeCommand />
        <ChargingCurvePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const mounted = render(tree());
  return { ...mounted, refresh: () => mounted.rerender(tree()) };
}

beforeEach((): void => {
  vi.clearAllMocks();
  localStorage.clear();
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
  h.vehicleId = 7;
  h.query = {
    data: [dc, ac], error: null, isError: false, isFetching: false,
    isLoading: false, isStale: false, fetchStatus: 'idle', dataUpdatedAt: 1,
    refetch: h.refetch,
  };
});
afterEach((): void => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  setGlobalPrecision(preferences.precision);
  setGlobalLocale(preferences.locale);
});

describe('charging curve production orchestration', () => {
  it('retains every metric, full ordered downstream session list, scope operands and AI scope', () => {
    const { container } = mountPage();
    expect(h.queryCall).toHaveBeenLastCalledWith(7, {
      limit: 200, start: '2024-05-01', end: '2024-05-31',
    });
    const tiles = container.querySelectorAll('[data-operational-metric]');
    expect(tiles).toHaveLength(6);
    const expected = [
      ['Total Sessions', '2'], ['Total Energy', '80.00 kWh'],
      ['Avg Charge Rate', '80.50 kW'], ['Peak Rate', '150.00 kW'],
      ['Avg Duration', '200 min'], ['Total Cost', '$16.75'],
    ];
    expected.forEach(([label, value], index) => {
      expect(tiles[index]?.firstElementChild?.firstElementChild).toHaveTextContent(label);
      expect(tiles[index]?.querySelector('[data-operational-value]')).toHaveTextContent(value);
    });
    for (const id of ['comparison', 'charger', 'speed', 'ttc']) {
      expect(screen.getByTestId(id)).toHaveAttribute('data-ids', '101,102');
    }
    expect(screen.getByTestId('fingerprint')).toHaveAttribute('data-vehicle', '7');
    expect(screen.getByTestId('ml')).toHaveAttribute('data-vehicle', '7');
    expect(container.querySelectorAll('[data-card-grid]')).toHaveLength(2);
    fireEvent.click(within(screen.getByTestId('charging-curve-summary')).getByRole('button', { name: 'Review details' }));
    const details = screen.getByRole('dialog', { name: 'Returned sessions in the workspace range details' });
    expect(within(details).getByRole('region', { name: 'Decision narrative' })).toHaveTextContent('Up to 200 returned sessions; not a full-history aggregate.');
  });

  it('preserves selected curve, details and all neighbors through retained refresh errors and retries', () => {
    const mounted = mountPage();
    fireEvent.change(screen.getByRole('combobox', { name: 'Inspect session' }), { target: { value: '101' } });
    expect(screen.getByTestId('curve')).toHaveAttribute('data-points', '61');
    expect(screen.getByTestId('curve')).toHaveAttribute('data-first-power', '150');
    expect(screen.getByTestId('details')).toHaveAttribute('data-session', '101');
    expect(screen.getByText(/Downtown Plaza/)).toBeInTheDocument();
    h.query = { ...h.query, isError: true, error: new Error('Refresh failed') };
    mounted.refresh();
    expect(screen.getByRole('combobox', { name: 'Inspect session' })).toHaveValue('101');
    expect(screen.getByTestId('curve')).toHaveAttribute('data-points', '61');
    expect(screen.getByTestId('details')).toHaveAttribute('data-session', '101');
    for (const id of ['comparison', 'charger', 'speed', 'ttc']) expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(mounted.container.querySelectorAll('[data-value-state="value"]')).toHaveLength(6);
    fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps real Router mounted while header range and vehicle changes reset selection', () => {
    const mounted = mountPage();
    const select = screen.getByRole('combobox', { name: 'Inspect session' });
    fireEvent.change(select, { target: { value: '101' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change workspace range' }));
    expect(select).toHaveValue('');
    expect(h.queryCall).toHaveBeenLastCalledWith(7, { limit: 200, start: '2024-06-01', end: '2024-06-30' });
    fireEvent.change(select, { target: { value: '102' } });
    h.vehicleId = 8;
    mounted.refresh();
    expect(select).toHaveValue('');
    expect(h.queryCall).toHaveBeenLastCalledWith(8, { limit: 200, start: '2024-06-01', end: '2024-06-30' });
    expect(screen.queryByTestId('curve')).not.toBeInTheDocument();
    expect(screen.queryByTestId('details')).not.toBeInTheDocument();
  });

  it('keeps six independent initial shells and six stat skeletons without ready charts', () => {
    h.query = { ...h.query, data: undefined, isLoading: true, fetchStatus: 'fetching' };
    const { container } = mountPage();
    expect(container.querySelectorAll('[data-card]')).toHaveLength(8);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    for (const id of ['curve', 'details', 'comparison', 'charger', 'speed', 'ttc']) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
    expect(screen.getByRole('combobox', { name: 'Inspect session' })).toBeDisabled();
  });

  it('initial fatal errors retain all shells and retry paths, not healthy zero metrics', () => {
    h.query = { ...h.query, data: undefined, isError: true, error: new Error('Request failed') };
    const { container } = mountPage();
    expect(container.querySelectorAll('[data-card]')).toHaveLength(8);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    const retry = screen.getAllByRole('button', { name: /retry|try again/i });
    expect(retry).toHaveLength(7);
    fireEvent.click(retry[0]);
    expect(h.refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('fingerprint')).toBeInTheDocument();
  });

  it('authoritative empty retains a known count of zero, unknown measurements and range-reset actions', () => {
    h.query = { ...h.query, data: [] };
    const { container } = mountPage();
    expect(container.querySelectorAll('[data-card]')).toHaveLength(8);
    expect(container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(5);
    expect(container.querySelector('[data-operational-metric="totalSessions"] [data-operational-value]')).toHaveTextContent('0');
    expect(screen.getAllByRole('button', { name: 'Reset date range' })).toHaveLength(6);
    expect(screen.getByRole('combobox', { name: 'Inspect session' })).toBeDisabled();
  });

  it('paused retained results remain usable while initial paused results do not pretend to load forever', () => {
    const mounted = mountPage();
    h.query = { ...h.query, fetchStatus: 'paused' };
    mounted.refresh();
    expect(screen.getByTestId('comparison')).toHaveAttribute('data-ids', '101,102');
    const warning = screen.getByTestId('stale-refresh-warning');
    expect(warning).toHaveTextContent('The latest values are temporarily unavailable. Previously loaded data remains visible.');
    expect(warning).toHaveAttribute('data-refresh-blocked', 'true');
    expect(warning).not.toHaveTextContent(/offline/i);
    h.query = { ...h.query, data: undefined };
    mounted.refresh();
    expect(mounted.container.querySelector('[data-operational-brief]')).not.toHaveAttribute('aria-busy', 'true');
    expect(mounted.container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(6);
    expect(screen.getAllByText('Charging sessions are waiting for a connection.')).toHaveLength(6);
  });

  it('never displays an all-unknown aggregate as measured zero; real zero remains a reading', () => {
    h.query = { ...h.query, data: [session({
      peak_power_w: null, cost_decimal: null, ended_at: null, end_soc_pct: null,
    })] };
    const mounted = mountPage();
    const summary = screen.getByTestId('charging-curve-summary');
    expect(summary.querySelectorAll('[data-value-state="missing"]')).toHaveLength(4);
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent(/incomplete/);
    expect(screen.getByTestId('comparison')).toHaveAttribute('data-ids', '101');
    h.query = { ...h.query, data: [session({ peak_power_w: 0, total_energy_added_wh: 0, cost_decimal: 0 })] };
    mounted.refresh();
    expect(summary.querySelectorAll('[data-value-state="missing"]')).toHaveLength(0);
    expect(summary.querySelector('[data-operational-metric="peakRate"] [data-operational-value]')).toHaveTextContent('0.00 kW');
  });

  it('leaves vehicle scope solely in the workspace header and does not invent a disabled-query loading state', () => {
    h.vehicleId = null;
    h.query = { ...h.query, data: undefined };
    const { container } = mountPage();
    expect(h.queryCall).toHaveBeenLastCalledWith(null, {
      limit: 200, start: '2024-05-01', end: '2024-05-31',
    });
    expect(container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(6);
    expect(container.querySelector('[data-operational-brief]')).not.toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByText('Choose a vehicle in the workspace header to view charging sessions.')).toHaveLength(6);
    expect(screen.getByTestId('fingerprint')).toHaveAttribute('data-vehicle', '');
    expect(screen.getByTestId('ml')).toHaveAttribute('data-vehicle', '');
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
  });
});
