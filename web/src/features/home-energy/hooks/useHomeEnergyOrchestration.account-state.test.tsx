import type { ReactNode } from 'react';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import type { StatMetric } from '@/components/data-display';
import type { Vehicle } from '@/types/vehicle';
import type { TeslaEnergySite } from '@/types/energy';
import { useHomeEnergyOrchestration } from './useHomeEnergyOrchestration';
import WholeHomeEnergyPage from '../pages/WholeHomeEnergyPage';

const h = vi.hoisted(() => ({
  vehicles: {} as DataStateSource<Vehicle[]>,
  sites: {} as DataStateSource<TeslaEnergySite[]>,
  metrics: [] as (readonly StatMetric[])[],
}));
vi.mock('@/api/hooks/useVehicles', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/hooks/useVehicles')>();
  return {
    ...actual,
    useVehicles: () => h.vehicles,
    useFleetStates: () => ({ data: [], isLoading: false, fetchStatus: 'idle', refetch: vi.fn() }),
  };
});
vi.mock('@/api/hooks/useEnergy', () => ({
  useTeslaEnergySites: () => h.sites,
  useTeslaEnergySiteInfo: () => ({ data: undefined }),
  useTeslaEnergyLiveStatus: () => ({ data: undefined }),
  useTeslaEnergyHistory: () => ({ data: undefined }),
}));
vi.mock('@/hooks/useOperationalMetrics', () => ({
  useOperationalMetrics: (metrics: readonly StatMetric[]) => {
    h.metrics.push(metrics);
    return metrics;
  },
}));
vi.mock('@/components/data-display', () => ({
  OperationalBrief: ({ testId, title, statusLabel, metrics }: {
    testId: string; title: string; statusLabel: string; metrics: readonly StatMetric[];
  }) => <section data-testid={testId}>
    <h2>{title}</h2><span>{statusLabel}</span>
    {metrics.map(metric => <div key={metric.occurrenceId}>{metric.description}{metric.context}</div>)}
  </section>,
  ProgressRing: () => null,
}));
vi.mock('@/components/layout', () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  LayoutCard: ({ children, title }: { children: ReactNode; title: string }) =>
    <section><h2>{title}</h2>{children}</section>,
  Grid: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/forms', () => ({
  FormSection: ({ children, title }: { children: ReactNode; title: string }) =>
    <section><h2>{title}</h2>{children}</section>,
}));
vi.mock('@/components/ui', () => {
  const Content = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Text: Content, Badge: Content,
    Accordion: ({ children, title }: { children: ReactNode; title: string }) =>
      <section><h3>{title}</h3>{children}</section>,
    Slider: Content, Toggle: Content, Select: Content,
  };
});
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ message }: { message: string }) => <div>{message}</div>,
  QueryError: () => null,
  StaleRefreshWarning: () => null,
  DataStateNotice: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../components', async () => {
  const summary = await import('../components/KpiSummary');
  const quality = await import('../components/AssumptionsQualityPanel');
  const assumptions = await import('../components/VehicleAssumptionsPanel');
  const readiness = await import('../components/VehicleReadinessPanel');
  const Shell = () => <div data-testid="modeled-section" />;
  return {
    ...summary, ...quality, ...assumptions, ...readiness,
    ScenarioControls: Shell, EnergyFlowChart: Shell, PowerwallTrajectoryChart: Shell,
    TariffConstraintHeatmap: Shell, ConstraintViolationsPanel: Shell, PlanExportPanel: Shell,
  };
});

const vehicle: Vehicle = {
  id: 42, vehicle_id: 42, vin: 'fixture', display_name: 'Family vehicle',
  model: 'Y', trim_badging: '', exterior_color: '', wheel_type: '',
  state: 'online', healthy: true, created_at: '', updated_at: '', battery_level: 0,
};
const site: TeslaEnergySite = {
  id: 1, energy_site_id: 1, resource_type: 'battery', site_name: 'Family home',
  gateway_id: null, total_pack_energy: null, percentage_charged: 0, battery_type: null,
  backup_capable: false, storm_mode_enabled: false, has_solar: true, has_battery: true,
  has_grid: true, has_load_meter: true, tou_capable: false, storm_mode_capable: false,
  fetched_at: '', created_at: '', updated_at: '', site_info_fetched_at: null,
};
function successful<T>(data: T): DataStateSource<T> {
  return { data, isSuccess: true, isLoading: false, fetchStatus: 'idle', dataUpdatedAt: Date.now() };
}
const clients: QueryClient[] = [];
function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/home-energy']}>{children}</MemoryRouter>
  </QueryClientProvider>;
}
function latestMetrics(size: number) {
  return h.metrics.filter(metrics => metrics.length === size).at(-1)!;
}
function assertShells() {
  expect(screen.getByTestId('home-energy-outcomes')).toBeInTheDocument();
  expect(screen.getByTestId('home-energy-forecast-quality')).toBeInTheDocument();
  expect(screen.getByText('Vehicle assumptions')).toBeInTheDocument();
  expect(screen.getByText('Per-vehicle readiness')).toBeInTheDocument();
  expect(screen.getAllByTestId('modeled-section')).toHaveLength(6);
}
beforeEach(() => {
  h.metrics = [];
  h.vehicles = successful([]);
  h.sites = successful([]);
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  localStorage.clear();
});

describe('orchestration account-source trust', () => {
  it.each(['fetching', 'paused'] as const)('keeps initial %s inputs unknown in the hook and mounted sections', fetchStatus => {
    const pending = { isPending: true, isLoading: fetchStatus === 'fetching',
      isFetching: fetchStatus === 'fetching', fetchStatus };
    h.vehicles = pending;
    h.sites = pending;
    const hook = renderHook(useHomeEnergyOrchestration);
    expect(hook.result.current.hasEnergySite).toBeNull();
    for (const id of ['vehicles', 'sites']) {
      const state = hook.result.current.sourceStates.find(source => source.id === id)!.state;
      expect(state.status).toBe('initial');
      expect(state.hasData).toBe(false);
      expect(state.data).toBeUndefined();
      expect(state.isRefreshBlocked).toBe(fetchStatus === 'paused');
    }
    const page = render(<WholeHomeEnergyPage />, { wrapper: Wrapper });
    assertShells();
    expect(latestMetrics(6).every(metric => metric.rawValue === null)).toBe(true);
    expect(latestMetrics(6).find(metric => metric.occurrenceId === 'vehicles-ready')!.display?.countTotal).toBeUndefined();
    expect(latestMetrics(2).every(metric => metric.rawValue === null)).toBe(true);
    expect(screen.queryByText(/No vehicles found on this account/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No vehicles are part of this plan/)).not.toBeInTheDocument();
    expect(screen.queryByText(/no Tesla energy site was found/)).not.toBeInTheDocument();
    expect(screen.queryByText('No history')).not.toBeInTheDocument();
    expect(screen.getAllByText(fetchStatus === 'paused' ? 'Source refresh paused' : 'Loading source inputs').length).toBeGreaterThan(1);
    h.vehicles = successful([]);
    h.sites = successful([]);
    hook.rerender();
    page.rerender(<WholeHomeEnergyPage />);
    assertShells();
    expect(hook.result.current.hasEnergySite).toBe(false);
    expect(latestMetrics(6).find(metric => metric.occurrenceId === 'vehicles-ready')!.rawValue).toBe(0);
    expect(latestMetrics(2).map(metric => metric.rawValue)).toEqual([0, 0]);
    expect(screen.getByText(/No vehicles found on this account/)).toBeInTheDocument();
  });

  it('does not infer an absent site or zero summary while only sites are paused', () => {
    h.sites = { isPending: true, fetchStatus: 'paused' };
    render(<WholeHomeEnergyPage />, { wrapper: Wrapper });
    assertShells();
    expect(latestMetrics(6).every(metric => metric.rawValue === null)).toBe(true);
    expect(latestMetrics(2).every(metric => metric.rawValue === null)).toBe(true);
    expect(screen.queryByText(/no Tesla energy site was found/)).not.toBeInTheDocument();
  });

  it('distinguishes successful empty accounts and actual zero measurements from unknown', () => {
    const hook = renderHook(useHomeEnergyOrchestration);
    expect(hook.result.current.hasEnergySite).toBe(false);
    render(<WholeHomeEnergyPage />, { wrapper: Wrapper });
    assertShells();
    expect(screen.getByText(/No vehicles found on this account/)).toBeInTheDocument();
    expect(screen.getByText(/no Tesla energy site was found/)).toBeInTheDocument();
    expect(latestMetrics(6).find(metric => metric.occurrenceId === 'vehicles-ready')!.rawValue).toBe(0);
    expect(latestMetrics(6).find(metric => metric.occurrenceId === 'unmet-energy')!.rawValue).toBe(0);
    expect(latestMetrics(2).map(metric => metric.rawValue)).toEqual([0, 0]);
    h.vehicles = successful([vehicle]);
    h.sites = successful([site]);
    hook.rerender();
    expect(hook.result.current.hasEnergySite).toBe(true);
    expect(hook.result.current.input.vehicles[0].currentSocPct).toBe(0);
    expect(hook.result.current.vehicleSocObservations[0].origin).toBe('vehicle-battery');
  });

  it('retains account data and sections after refresh failure, then recovers', () => {
    h.vehicles = successful([vehicle]);
    h.sites = successful([site]);
    const hook = renderHook(useHomeEnergyOrchestration);
    const page = render(<WholeHomeEnergyPage />, { wrapper: Wrapper });
    const before = latestMetrics(6).map(metric => metric.rawValue);
    const error = new Error('Account refresh failed');
    h.vehicles = { ...h.vehicles, error, isError: true };
    h.sites = { ...h.sites, error, isError: true };
    hook.rerender();
    page.rerender(<WholeHomeEnergyPage />);
    assertShells();
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.hasEnergySite).toBe(true);
    expect(hook.result.current.vehicles).toEqual([vehicle]);
    expect(latestMetrics(6).map(metric => metric.rawValue)).toEqual(before);
    expect(screen.getByText(/Family home/)).toBeInTheDocument();
    for (const id of ['vehicles', 'sites']) {
      const state = hook.result.current.sourceStates.find(source => source.id === id)!.state;
      expect(state.status).toBe('stale');
      expect(state.refreshError).toBe(error);
      expect(state.fatalError).toBeNull();
    }
    h.vehicles = successful([vehicle]);
    h.sites = successful([site]);
    hook.rerender();
    page.rerender(<WholeHomeEnergyPage />);
    assertShells();
    expect(latestMetrics(6).map(metric => metric.rawValue)).toEqual(before);
    for (const id of ['vehicles', 'sites']) {
      const state = hook.result.current.sourceStates.find(source => source.id === id)!.state;
      expect(state.status).toBe('ok');
      expect(state.refreshError).toBeNull();
    }
  });
});
