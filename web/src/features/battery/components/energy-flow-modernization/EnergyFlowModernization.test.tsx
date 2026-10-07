/**
 * Authored runtime regressions — NOTRUN by this source writer.
 * Real router, real shared trust/layout/stat/table/chart containers. Only data
 * hooks and entrance motion are replaced; no fixture presentation controller.
 */
import type { ComponentProps } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEnergyFlow, useEnergyStats } from '@/api/hooks/useEnergy';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { ApiError } from '@/lib/resilience';
import { formatDateShort } from '@/lib/dateFormat';
import { formatDistance, formatEnergy } from '@/lib/unitConversion';
import type { EnergyFlowData, EnergyStats } from '@/types/energy';
import EnergyFlowPage from '../../pages/EnergyFlowPage';

vi.mock('@/api/hooks/useEnergy', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/hooks/useEnergy')>();
  return { ...actual, useEnergyStats: vi.fn(), useEnergyFlow: vi.fn() };
});
vi.mock('@/hooks/useSelectedVehicle', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useSelectedVehicle')>();
  return { ...actual, useSelectedVehicle: vi.fn() };
});
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return {
    ...actual,
    FadeIn: ({ children }: ComponentProps<typeof actual.FadeIn>) => <>{children}</>,
  };
});

const stats: EnergyStats = {
  period_days: 7, total_energy_used_wh: 21000, total_energy_charged_wh: 27000,
  total_wh: 21000, total_cost: 4.2, total_distance_m: 150000,
  avg_efficiency_wh_per_m: 0.14, co2_saved_kg: 25.5,
  daily_breakdown: [
    { date: '2026-10-01', energy_wh: 12000, distance_m: 100000, efficiency_wh_per_m: 0.12, cost: 2.4 },
    { date: '2026-10-02', energy_wh: 9000, distance_m: 50000, efficiency_wh_per_m: 0.18, cost: 1.8 },
  ],
};
const flow: EnergyFlowData = {
  dc_charging_power: 10, ac_charging_power: 2, soc: 62,
  energy_remaining: 44, pack_voltage: 380, pack_current: 32, charge_state: 'Charging',
};
const statsRetry = vi.fn(async () => undefined);
const flowRetry = vi.fn(async () => undefined);
const mockStats = vi.mocked(useEnergyStats);
const mockFlow = vi.mocked(useEnergyFlow);
const selected = vi.mocked(useSelectedVehicle);

/** Structural query fixture retains the fields used by useDataState and the
 * real PageContainer source-health/freshness surfaces. */
function query<T>(data: T | undefined, retry: () => Promise<undefined>, overrides: {
  error?: Error | null; isError?: boolean; fetchStatus?: 'idle' | 'paused' | 'fetching';
  isLoading?: boolean; isPending?: boolean;
} = {}) {
  return {
    data, refetch: retry, dataUpdatedAt: data === undefined ? 0 : 1790899200000,
    error: null, isError: false, isSuccess: data !== undefined, isLoading: false,
    isPending: data === undefined, isStale: false, isFetching: false,
    fetchStatus: 'idle' as const, ...overrides,
  };
}
function setStats(data: EnergyStats | undefined, overrides: Parameters<typeof query>[2] = {}) {
  mockStats.mockReturnValue(query(data, statsRetry, overrides) as unknown as ReturnType<typeof useEnergyStats>);
}
function setFlow(data: EnergyFlowData | undefined, overrides: Parameters<typeof query>[2] = {}) {
  mockFlow.mockReturnValue(query(data, flowRetry, overrides) as unknown as ReturnType<typeof useEnergyFlow>);
}
function card(title: string): HTMLElement {
  const shells = screen.getAllByRole('heading', { name: title, exact: true })
    .map(heading => heading.closest('[data-card]'));
  expect(new Set(shells).size).toBe(1);
  const shell = shells[0];
  if (!(shell instanceof HTMLElement)) throw new Error(`Missing card: ${title}`);
  return shell;
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Tree() {
    return <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/energy-flow?from=2026-09-28&to=2026-10-04&vehicle_id=42']}>
        <Routes><Route path="/energy-flow" element={<EnergyFlowPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>;
  }
  const view = render(<Tree />);
  // Same component, QueryClient and real MemoryRouter instance on rerenders.
  return { ...view, update: () => { view.rerender(<Tree />); }, client };
}

beforeEach(() => {
  void vi.clearAllMocks();
  void localStorage.clear();
  selected.mockReturnValue({ vehicleId: 42, vehicle: null, vehicles: [], setVehicleId: vi.fn() });
  setStats(stats);
  setFlow(flow);
});
afterEach(() => { void cleanup(); void vi.unstubAllGlobals(); });

describe('Energy flow modernization — real shared surfaces', () => {
  it('retains all cards, chart accessibility tables and exact hook operands', () => {
    const view = mount();
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(8);
    expect(view.container.querySelector('[data-layout-reference]')).toBeInTheDocument();
    expect(mockStats).toHaveBeenLastCalledWith('42', 7);
    expect(mockFlow).toHaveBeenLastCalledWith('42');
    for (const title of ['Daily energy usage', 'Daily distance', 'Daily efficiency']) {
      expect(within(card(title)).getByRole('table', { hidden: true })).toBeInTheDocument();
    }
    expect(within(card('Energy flow diagram')).getByText('12.00 kW')).toBeInTheDocument();
    const efficiency = card('Efficiency metrics');
    const context = efficiency.querySelector('[data-battery-detail-context]');
    expect(context).not.toBeNull();
    expect(within(context as HTMLElement).getByText('Excellent')).toBeInTheDocument();
  });

  it('keeps retained stats and all independent live facts when refresh fails or pauses', () => {
    const view = mount();
    setStats(stats, { error: new ApiError('technical SQL failure', 500), isError: true });
    view.update();
    expect(within(card('Daily energy usage')).getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(within(card('Daily energy history')).getByRole('table')).toBeInTheDocument();
    expect(within(card('Live power')).getByText('10.00 kW')).toBeInTheDocument();
    expect(within(card('Daily energy usage')).queryByText('technical SQL failure')).not.toBeInTheDocument();
    setStats(stats, { fetchStatus: 'paused' });
    view.update();
    expect(within(card('Daily distance')).getByText(
      'The device is offline, so this section is showing the last values it received.',
    )).toBeInTheDocument();
    fireEvent.click(within(card('Daily distance')).getByRole('button', { name: 'Refresh', exact: true }));
    expect(statsRetry).toHaveBeenCalledOnce();
  });

  it('keeps historical neighbors and friendly recovery when the live source initially fails', () => {
    setFlow(undefined, { error: new ApiError('technical signal failure', 500), isError: true });
    mount();
    expect(within(card('Live power')).getByText('Server error')).toBeInTheDocument();
    expect(within(card('Live power')).queryByText('technical signal failure')).not.toBeInTheDocument();
    expect(within(card('Daily distance')).getByRole('table', { hidden: true })).toBeInTheDocument();
    fireEvent.click(within(card('Live power')).getByRole('button', { name: 'Retry', exact: true }));
    expect(flowRetry).toHaveBeenCalledOnce();
  });

  it('does not turn missing SOC, either charge channel or daily values into zero', () => {
    setFlow({ ...flow, soc: null, dc_charging_power: null, ac_charging_power: 2 });
    mount();
    expect(within(card('Energy flow diagram')).getAllByText('—')).toHaveLength(2);
    expect(within(card('Live power')).getByText('—')).toBeInTheDocument();
    expect(within(card('Live power')).getByText('2.00 kW')).toBeInTheDocument();
  });

  it('distinguishes initial paused, loading and empty sources without removing shells', () => {
    setFlow(undefined, { fetchStatus: 'paused', isPending: true });
    const view = mount();
    expect(within(card('Live power')).getByText(
      'This source is paused. No measurements have been received yet.',
    )).toBeInTheDocument();
    setFlow(undefined, { isLoading: true, isPending: true, fetchStatus: 'fetching' });
    view.update();
    expect(card('Live power').querySelector('.animate-pulse')).toBeInTheDocument();
    expect(within(card('Live power')).queryByText('No live power data available.')).not.toBeInTheDocument();
    setFlow(undefined, { isPending: false });
    view.update();
    expect(within(card('Live power')).getByText('No live power data available.')).toBeInTheDocument();
    fireEvent.click(within(card('Live power')).getByRole('button', { name: 'Refresh', exact: true }));
    expect(flowRetry).toHaveBeenCalledOnce();
    expect(statsRetry).not.toHaveBeenCalled();
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(8);
  });

  it('keeps all section shells and onboarding recovery without a selected vehicle', () => {
    selected.mockReturnValue({ vehicleId: null, vehicle: null, vehicles: [], setVehicleId: vi.fn() });
    const view = mount();
    expect(mockStats).toHaveBeenLastCalledWith(null, 7);
    expect(mockFlow).toHaveBeenLastCalledWith(null);
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(8);
    expect(within(card('Live power')).getByRole('link', { name: 'Set up TeslaSync' }))
      .toHaveAttribute('href', '/onboarding');
  });

  it('keeps all measurements in the actual mobile details and shared table controller', async () => {
    class PhoneResizeObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: { width: 375, height: 280 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', PhoneResizeObserver);
    mount();
    const history = card('Daily energy history');
    const mobile = await waitFor(() => {
      const node = history.querySelector('[data-mobile-table]');
      expect(node).toBeInTheDocument();
      return node as HTMLElement;
    });
    const firstDate = formatDateShort(stats.daily_breakdown[1].date);
    // Row activation is scoped to the real mobile adapter, never broad labels
    // that can also match the containing named sections.
    fireEvent.click(within(mobile).getByRole('button', { name: new RegExp(firstDate) }));
    const dialog = screen.getByRole('dialog');
    const prefs = { distance: 'km' as const, speed: 'km/h' as const, temperature: '°C' as const,
      pressure: 'bar' as const, energy: 'kWh' as const, duration: 'h' as const, power: 'kW' as const,
      precision: 2, locale: 'en-US' };
    expect(within(dialog).getByText(formatDistance(50000, prefs))).toBeInTheDocument();
    expect(within(dialog).getByText(formatEnergy(9000, prefs))).toBeInTheDocument();
    const footer = dialog.querySelector('[data-modal-footer]');
    expect(footer).not.toBeNull();
    fireEvent.click(within(footer as HTMLElement).getByRole('button', { name: 'Close', exact: true }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
  });
});
