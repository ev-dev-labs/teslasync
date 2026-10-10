import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DataStateSource } from '@/api/dataState';
import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';

const mocks = vi.hoisted(() => ({
  charging: vi.fn(),
  driving: vi.fn(),
  selected: vi.fn(),
  retryCharging: vi.fn(),
  retryDriving: vi.fn(),
}));

vi.mock('@/api/hooks/useCharging', () => ({
  useChargingHistory: (...args: unknown[]) => mocks.charging(...args),
}));
vi.mock('@/api/hooks/useDriving', () => ({
  useDriveHistory: (...args: unknown[]) => mocks.driving(...args),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => mocks.selected(),
}));
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return {
    ...actual,
    FadeIn: ({ children }: PropsWithChildren) => <>{children}</>,
  };
});

import BatteryCarePage from '../../pages/BatteryCarePage';
import { computeBatteryCare } from '../../lib/batteryCare';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';

const NOW = Date.UTC(2026, 9, 4, 12);
const stamp = new Date(NOW).toISOString();
function session(id: number, endSoc: number | null = 95): ChargingSession {
  return {
    id: String(id),
    vehicle_id: '42',
    charger_type: 'AC',
    start_soc_pct: 20,
    end_soc_pct: endSoc,
    total_energy_added_wh: 10_000,
    peak_power_w: 7_000,
    cost_decimal: null,
    started_at: stamp,
    start_ts: stamp,
    startedAt: stamp,
    duration_min: 60,
  };
}
function drive(id: number, arrival: number | null = 5): Drive {
  return {
    id, vehicleId: 42, startTs: stamp, endTs: stamp,
    durationS: 3600, distanceM: 20_000,
    startAddress: null, endAddress: null,
    startLat: null, startLon: null, endLat: null, endLon: null,
    startBatteryPct: 30, endBatteryPct: arrival,
    energyUsedWh: null, regenEnergyWh: null,
    avgSpeedMps: null, maxSpeedMps: null, avgPowerW: null,
    outsideTempAvgC: null, insideTempAvgC: null,
    score: null, endedStatus: null, createdAt: stamp, updatedAt: stamp,
  };
}
const sessions = Array.from({ length: 5 }, (_, index) => session(index));
const drives = Array.from({ length: 5 }, (_, index) => drive(index));
const sections = [
  'battery-care-kpis', 'battery-care-score', 'battery-care-targets',
  'battery-care-energy', 'battery-care-arrivals', 'battery-care-trend',
  'battery-care-habits', 'battery-care-methodology',
];

function query<T>(data: T | undefined, retry: () => void, overrides: Partial<DataStateSource<T>> = {}) {
  return {
    data, refetch: retry, isLoading: data === undefined,
    isPending: data === undefined, isError: false, error: null,
    isFetching: false, isStale: false, fetchStatus: 'idle' as const,
    dataUpdatedAt: data === undefined ? 0 : NOW,
    ...overrides,
  };
}

/** Same wrapper identity persists through rerender; real Router and QueryClient. */
function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/battery-care']}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<BatteryCarePage />, { wrapper: Wrapper });
}

beforeEach((): void => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  mocks.selected.mockReturnValue({ vehicleId: 42 });
  mocks.charging.mockReturnValue(query(sessions, mocks.retryCharging));
  mocks.driving.mockReturnValue(query(drives, mocks.retryDriving));
});

afterEach((): void => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('live Battery Care mounted preservation', () => {
  it('keeps eight real section shells and unchanged history operands', () => {
    mountPage();
    for (const id of sections) expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(mocks.charging).toHaveBeenCalledWith('42', 1000);
    expect(mocks.driving).toHaveBeenCalledWith('42', 1000);
    const care = computeBatteryCare(sessions, drives, { nowMs: NOW, sessionLimit: 1000, driveLimit: 1000 });
    const summary = screen.getByTestId('battery-care-kpis');
    expect(summary).toHaveTextContent(fmtInt(care.score));
    expect(summary).toHaveTextContent(fmtPercent(care.fullChargeShare == null ? null : care.fullChargeShare * 100));
    expect(summary).toHaveTextContent('of 5 sessions');
    expect(summary).toHaveTextContent('of 5 drive arrivals below 10%');
    expect(screen.getByTestId('battery-care-habits')).toHaveTextContent('Current index deduction:');
    expect(screen.getByTestId('battery-care-methodology')).toHaveTextContent('peak power exceeds');
  });

  it('retains charging metrics, monthly rows and warnings on refresh failure', () => {
    const view = mountPage();
    mocks.charging.mockReturnValue(query(sessions, mocks.retryCharging, {
      error: new Error('charging refresh failed'), isError: true,
    }));
    view.rerender(<BatteryCarePage />);
    for (const id of sections) expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(screen.getByTestId('battery-care-energy')).toHaveTextContent('Measured energy returned');
    expect(screen.getByTestId('battery-care-targets')).toHaveTextContent('Median session-end SoC');
    expect(screen.getByTestId('battery-care-arrivals')).toHaveTextContent('Median drive-arrival SoC');
    expect(screen.getAllByTestId('stale-refresh-warning').length).toBeGreaterThan(0);
    const warning = within(screen.getByTestId('battery-care-energy')).getByTestId('stale-refresh-warning');
    fireEvent.click(within(warning).getByRole('button'));
    expect(mocks.retryCharging).toHaveBeenCalledTimes(1);
    expect(mocks.retryDriving).not.toHaveBeenCalled();
    const evidence = screen.getByTestId('battery-care-monthly-table');
    expect(within(evidence).getByRole('table')).toBeInTheDocument();
    for (const label of ['Month', 'Care index', 'Eligible sessions', 'Eligible drives']) {
      expect(within(evidence).getByRole('columnheader', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('keeps charging evidence when drive initial load fails; never claims calibrated score', () => {
    mocks.driving.mockReturnValue(query(undefined, mocks.retryDriving, {
      error: new Error('drive first load failed'), isError: true,
    }));
    mountPage();
    for (const id of sections) expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(screen.getByTestId('battery-care-energy')).toHaveTextContent('Measured energy returned');
    expect(screen.getByTestId('battery-care-kpis')).toHaveTextContent('calibrating evidence');
    expect(screen.getByTestId('battery-care-score')).toHaveTextContent('Not calibrated');
    const failedArrivals = screen.getByTestId('battery-care-arrivals');
    expect(within(failedArrivals).getByRole('alert')).toHaveTextContent("Can't reach server");
    fireEvent.click(within(failedArrivals).getByRole('button', { name: 'Retry' }));
    expect(mocks.retryDriving).toHaveBeenCalledTimes(1);
    expect(mocks.retryCharging).not.toHaveBeenCalled();
  });

  it('keeps drive evidence when charging first load fails', () => {
    mocks.charging.mockReturnValue(query(undefined, mocks.retryCharging, {
      error: new Error('charging first load failed'), isError: true,
    }));
    mountPage();
    expect(screen.getByTestId('battery-care-arrivals')).toHaveTextContent('Median drive-arrival SoC');
    const failedEnergy = screen.getByTestId('battery-care-energy');
    expect(within(failedEnergy).getByRole('alert')).toHaveTextContent("Can't reach server");
    fireEvent.click(within(failedEnergy).getByRole('button', { name: 'Retry' }));
    expect(mocks.retryCharging).toHaveBeenCalledTimes(1);
    expect(mocks.retryDriving).not.toHaveBeenCalled();
    expect(screen.getByTestId('battery-care-kpis')).toHaveTextContent('calibrating evidence');
  });

  it('keeps all shells on both initial failures and retries only failed sources', () => {
    mocks.charging.mockReturnValue(query(undefined, mocks.retryCharging, { error: new Error('charging unavailable'), isError: true }));
    mocks.driving.mockReturnValue(query(undefined, mocks.retryDriving, { error: new Error('drives unavailable'), isError: true }));
    mountPage();
    for (const id of sections) expect(screen.getByTestId(id)).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('battery-care-kpis')).getByRole('button'));
    expect(mocks.retryCharging).toHaveBeenCalledTimes(1);
    expect(mocks.retryDriving).toHaveBeenCalledTimes(1);
  });

  it('renders initial skeletons independently and retains its successful neighbor', () => {
    mocks.charging.mockReturnValue(query(undefined, mocks.retryCharging, { fetchStatus: 'fetching', isFetching: true }));
    mountPage();
    expect(screen.getByTestId('battery-care-energy')).not.toHaveTextContent('Measured energy returned');
    expect(screen.getByTestId('battery-care-arrivals')).toHaveTextContent('Median drive-arrival SoC');
    expect(screen.getByTestId('battery-care-kpis')).toHaveTextContent('calibrating evidence');
  });

  it('distinguishes authoritative empty from initial loading', () => {
    mocks.charging.mockReturnValue(query([], mocks.retryCharging));
    mocks.driving.mockReturnValue(query([], mocks.retryDriving));
    mountPage();
    for (const id of sections) expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(screen.getByTestId('battery-care-energy')).toHaveTextContent('No charging sessions with positive measured energy');
    expect(screen.getByTestId('battery-care-arrivals')).toHaveTextContent('No drives with a valid arrival SoC');
    expect(screen.getByTestId('battery-care-kpis')).toHaveTextContent('No usable session-end');
  });

  it('keeps retained evidence while offline without fatal errors', () => {
    const view = mountPage();
    mocks.charging.mockReturnValue(query(sessions, mocks.retryCharging, { fetchStatus: 'paused' }));
    view.rerender(<BatteryCarePage />);
    expect(screen.getByTestId('battery-care-energy')).toHaveTextContent('Measured energy returned');
    const warning = within(screen.getByTestId('battery-care-energy')).getByTestId('stale-refresh-warning');
    expect(warning).toHaveAttribute('data-refresh-blocked', 'true');
    expect(warning).toHaveTextContent('The latest values are temporarily unavailable. Previously loaded data remains visible.');
    expect(warning).not.toHaveTextContent('offline');
    expect(within(screen.getByTestId('battery-care-energy')).queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('battery-care-arrivals')).toHaveTextContent('Median drive-arrival SoC');
  });

  it('keeps all four monthly fields reachable through the real mobile adapter', () => {
    vi.stubGlobal('ResizeObserver', class implements ResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element): void {
        if (!target.hasAttribute('data-grid-frame')) return;
        this.callback([{
          target,
          contentRect: new DOMRectReadOnly(0, 0, 375, 340),
          borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [],
        }], this);
      }
      unobserve(): void {}
      disconnect(): void {}
    });
    mountPage();
    const table = screen.getByTestId('battery-care-monthly-table');
    expect(table.querySelector('[data-card-meta][data-field-key="sessions"]')).not.toBeNull();
    expect(table.querySelector('[data-card-meta][data-field-key="drives"]')).not.toBeNull();
    const care = computeBatteryCare(sessions, drives, { nowMs: NOW });
    const activeMonth = care.monthly.find(month => month.sessionsAnalyzed === 5);
    expect(activeMonth).toBeDefined();
    if (!activeMonth) throw new Error('Expected source-backed monthly evidence');
    fireEvent.click(within(table).getByRole('button', { name: activeMonth.month }));
    const dialog = screen.getByRole('dialog');
    for (const label of ['Month', 'Care index', 'Eligible sessions', 'Eligible drives']) {
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    }
    expect(dialog).toHaveTextContent(activeMonth.month);
    expect(within(dialog).getAllByText('5')).toHaveLength(2);
    const closeButtons = within(dialog).getAllByRole('button', { name: 'Close', exact: true });
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not invent retained evidence for an initially paused source', () => {
    mocks.charging.mockReturnValue(query(undefined, mocks.retryCharging, { fetchStatus: 'paused' }));
    mountPage();
    expect(screen.getByTestId('battery-care-energy')).toHaveTextContent('No observations have been received yet');
    expect(screen.getByTestId('battery-care-energy')).not.toHaveTextContent('Measured energy returned');
  });

  it('preserves unknown SoC rather than displaying a healthy zero', () => {
    mocks.charging.mockReturnValue(query([session(1, null)], mocks.retryCharging));
    mocks.driving.mockReturnValue(query([drive(1, null)], mocks.retryDriving));
    mountPage();
    expect(screen.getByTestId('battery-care-kpis')).toHaveTextContent('calibrating evidence');
    expect(screen.getByTestId('battery-care-score')).toHaveTextContent('Not calibrated');
    expect(screen.getByTestId('battery-care-targets')).toHaveTextContent('No charging sessions with a valid end SoC');
    expect(screen.getByTestId('battery-care-arrivals')).toHaveTextContent('No drives with a valid arrival SoC');
  });

  it('preserves the no-vehicle prerequisite and undefined hook operands', () => {
    mocks.selected.mockReturnValue({ vehicleId: null });
    mountPage();
    expect(screen.getByText('No vehicle selected')).toBeInTheDocument();
    expect(mocks.charging).toHaveBeenCalledWith(undefined, 1000);
    expect(mocks.driving).toHaveBeenCalledWith(undefined, 1000);
    expect(screen.queryByTestId('battery-care-energy')).not.toBeInTheDocument();
  });
});
