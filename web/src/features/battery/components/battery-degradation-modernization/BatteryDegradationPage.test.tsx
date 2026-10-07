// Authored for the parent's serialized runtime window. NOTRUN in this writer.
import type { ComponentProps, PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BatteryHealthAnalytics } from '@/types/energy';
import BatteryDegradationPage from '../../pages/BatteryDegradationPage';

const source = vi.hoisted(() => ({
  data: undefined as BatteryHealthAnalytics | undefined,
  error: null as Error | null,
  isError: false,
  isLoading: false,
  isFetching: false,
  isPending: false,
  isSuccess: true,
  fetchStatus: 'idle' as 'idle' | 'paused' | 'fetching',
  dataUpdatedAt: 0,
  refetch: vi.fn(),
}));

vi.mock('@/api/hooks/useEnergy', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/hooks/useEnergy')>();
  return { ...actual, useBatteryHealthAnalytics: () => source };
});
vi.mock('@/hooks/useSelectedVehicle', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useSelectedVehicle')>();
  return { ...actual, useSelectedVehicle: () => ({ vehicleId: 17 }) };
});
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return {
    ...actual,
    FadeIn: ({ children }: ComponentProps<typeof actual.FadeIn>) => <>{children}</>,
  };
});

function analytics(): BatteryHealthAnalytics {
  return {
    vehicle_id: 17, current_soh: 0, estimated_capacity_wh: 0, original_capacity_wh: 75000,
    degradation_rate_pct_per_year: 0, battery_age_months: 13, total_cycles: 12.5,
    avg_depth_of_discharge_pct: 20, fast_charge_pct: 0, full_charge_pct: 0,
    charge_habits_score: 100, stress_level: 'Low', temp_exposure_score: null,
    temp_exposure_reason: 'Temperature telemetry is unavailable.',
    history: [
      { date: '2025-01-01', odometer_m: 100000, soh_pct: 96, capacity_wh: 72000, range_m: 450000 },
      { date: '2025-02-01', odometer_m: 110000, soh_pct: 95, capacity_wh: 71250, range_m: 445000 },
      { date: '2025-03-01', odometer_m: 120000, soh_pct: 94, capacity_wh: 70500, range_m: 440000 },
    ],
    prediction: {
      has_enough_data: true, slope_per_year: -2, years_to_80_pct: 7,
      predicted_date: '2032-03-01', projection_points: [],
    },
    projections: [{ date: '2026-03-01', health_pct: 92, confidence_low: 89, confidence_high: 95 }],
    charging_habits: {
      fast_charge_count: 0, slow_charge_count: 20, deep_discharge_count: 0,
      charge_to_full_count: 0, high_soc_count: 0, avg_energy_per_session: 10000, total_count: 20,
    },
    risk_factors: [{ name: 'fast_charge_ratio', score: 0, label: 'Low', detail: 'No fast charges in this sample.' }],
    recommendations: ['Keep the existing charging pattern.'],
    charging_analysis: {
      charge_level_distribution: [], avg_start_soc_pct: 20, avg_end_soc_pct: 80,
      ac_session_count: 20, dc_session_count: 0, supercharger_count: 0,
      dc_fast_count: 0, deep_discharge_count: 0,
      ac_energy_wh: 200000, dc_energy_wh: 0, total_sessions: 20,
    },
    capacity_source: 'estimated',
  };
}

let queryClient: QueryClient;
function Harness({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/battery-degradation?vehicle_id=17']}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  Object.assign(source, {
    data: analytics(), error: null, isError: false, isLoading: false,
    isFetching: false, isPending: false, isSuccess: true, fetchStatus: 'idle',
    dataUpdatedAt: Date.now(),
  });
  // Invoke real production DataTable/container-width adapters at phone width.
  vi.stubGlobal('ResizeObserver', class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback([{
        target, contentRect: { width: 390, height: 300 } as DOMRectReadOnly,
      } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe('battery degradation trust and preservation', () => {
  it('refreshes the analytics source from an unusable health measurement without inventing SOH', () => {
    source.data = { ...analytics(), current_soh: Number.NaN };
    const mounted = render(<BatteryDegradationPage />, { wrapper: Harness });
    const healthCard = Array.from(mounted.container.querySelectorAll<HTMLElement>('[data-card]'))
      .find(card => card.querySelector('[data-card-title]')?.textContent === 'Battery health');
    expect(healthCard).toBeDefined();
    const health = within(healthCard!);
    expect(health.getByText('Battery health is not available yet.')).toBeVisible();
    fireEvent.click(health.getByRole('button', { name: 'Refresh', exact: true }));
    expect(source.refetch).toHaveBeenCalledOnce();
    expect(source.data.current_soh).toBeNaN();
    expect(source.data.history[0].capacity_wh).toBe(72000);
    expect(source.data.history[0].range_m).toBe(450000);
  });

  it('keeps every panel, table details, scientific evidence and charts on a failed retained refresh', () => {
    const mounted = render(<BatteryDegradationPage />, { wrapper: Harness });
    source.error = new Error('Battery analytics refresh failed');
    source.isError = true;
    // Harness (including the real Router) persists across this rerender.
    mounted.rerender(<BatteryDegradationPage />);
    expect(screen.getByTestId('stale-refresh-warning')).toBeVisible();
    for (const title of [
      'Battery health', 'Prediction', 'Charging habits impact', 'Range loss over time',
      'Risk factors', 'Recommendations', 'Battery health factors', 'Degradation history',
    ]) {
      const cards = Array.from(mounted.container.querySelectorAll<HTMLElement>('[data-card]'))
        .filter(card => card.querySelector('[data-card-title]')?.textContent === title);
      expect(cards).toHaveLength(1);
      const header = cards[0].querySelector<HTMLElement>('header')!;
      const heading = within(header).getByRole('heading', { name: title, exact: true });
      expect(heading).toBeVisible();
      expect(cards[0]).toHaveAttribute('aria-labelledby', heading.id);
    }
    const rangeFigure = screen.getByRole('figure', { name: 'Range loss over time', exact: true });
    const rangeFigureTitle = within(rangeFigure).getByRole('heading', { name: 'Range loss over time', exact: true });
    expect(rangeFigure).toBeVisible();
    expect(rangeFigure).toHaveAttribute('aria-labelledby', rangeFigureTitle.id);
    expect(rangeFigure.closest('[data-card]')).toHaveAttribute(
      'aria-labelledby', rangeFigure.closest('[data-card]')!.querySelector('[data-card-title]')!.id,
    );
    expect(within(rangeFigure).getByRole('group', {
      name: 'Original and current estimated driving range over time', exact: true,
    })).toBeVisible();
    expect(screen.getByText('Keep the existing charging pattern.')).toBeVisible();
    expect(screen.getByText('No fast charges in this sample.')).toBeVisible();
    expect(mounted.container.querySelectorAll('figure')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Quick view' })).toHaveLength(3);
    expect(screen.getByText('2032-03-01', { exact: false })).toBeVisible();
  });

  it('preserves actual zero metrics while unknown temperature remains neutral with its evidence', () => {
    const mounted = render(<BatteryDegradationPage />, { wrapper: Harness });
    const summary = mounted.container.querySelector('#battery-degradation-summary')!;
    const zeroSoh = summary.querySelectorAll('[data-operational-value]')[0]!;
    expect(zeroSoh.textContent).toMatch(/^0(?:[.,]0+)?%$/);
    expect(summary.querySelectorAll('[data-operational-value]')[1]!.textContent).toMatch(/^0(?:[.,]0+)? kWh$/);
    const tempTitle = screen.getByText('Temperature exposure');
    const tempPanel = tempTitle.closest('[data-glass-panel]') ?? tempTitle.parentElement!.parentElement!;
    expect(within(tempPanel as HTMLElement).getByText('—/100')).toBeVisible();
    expect(screen.getByText('Temperature telemetry is unavailable.')).toBeVisible();
    expect(mounted.container.textContent).not.toContain('NaN');
    expect(mounted.container.textContent).toContain('1y 1m');
  });

  it('keeps every mobile history field reachable through the real detail dialog', () => {
    render(<BatteryDegradationPage />, { wrapper: Harness });
    const trigger = screen.getAllByRole('button', { name: 'Quick view' })[0];
    trigger.focus();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    for (const field of ['Date', 'Odometer', 'SOH %', 'Capacity', 'Range']) {
      expect(within(dialog).getByText(field, { exact: true })).toBeVisible();
    }
    expect(dialog.textContent).toContain('km');
    expect(dialog.textContent).toContain('kWh');
    expect(source.data!.history[0].capacity_wh).toBe(72000);
    expect(source.data!.history[0].range_m).toBe(450000);
    const footer = dialog.querySelector<HTMLElement>('[data-modal-footer="true"]')!;
    expect(footer).toBeVisible();
    const close = within(footer).getByRole('button', { name: 'Close', exact: true });
    close.focus();
    expect(close).toHaveFocus();
    fireEvent.click(close);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('retains content when paused and renders all shells on initial failure', () => {
    const mounted = render(<BatteryDegradationPage />, { wrapper: Harness });
    source.fetchStatus = 'paused';
    mounted.rerender(<BatteryDegradationPage />);
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('offline');
    expect(screen.getAllByRole('button', { name: 'Quick view' })).toHaveLength(3);
    source.data = undefined;
    source.error = new Error('Battery history could not load');
    source.isError = true;
    source.fetchStatus = 'idle';
    mounted.rerender(<BatteryDegradationPage />);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    const fatalAlerts = screen.getAllByRole('alert');
    // Nine section-level QueryErrors plus the trend ChartContainer's own error surface.
    expect(fatalAlerts).toHaveLength(10);
    for (const alert of fatalAlerts) {
      expect(alert).toBeVisible();
      expect(alert).toHaveAttribute('aria-live', 'assertive');
      expect(within(alert).getByText("Can't reach server", { exact: true })).toBeVisible();
      expect(within(alert).getByText('Check your internet connection and try again.', { exact: true })).toBeVisible();
    }
    expect(screen.queryByText('Battery history could not load')).not.toBeInTheDocument();
    const failedTrend = screen.getByRole('figure', { name: 'Health trend & projection', exact: true });
    expect(failedTrend).toHaveAttribute('data-chart-state', 'error');
    const trendAlert = within(failedTrend).getByRole('alert');
    const retry = within(trendAlert).getByRole('button', { name: 'Retry', exact: true });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    expect(source.refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Quick view' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Degradation history' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Health trend & projection' })).toBeVisible();
  });

  it('never invents zero or healthy status for a missing summary field, and keeps empty section shells', () => {
    source.data!.history = [];
    source.data!.projections = [];
    source.data!.risk_factors = [];
    source.data!.recommendations = [];
    source.data!.prediction.has_enough_data = false;
    // Simulate a partial wire payload without changing the production domain type.
    Reflect.deleteProperty(source.data!, 'current_soh');
    const mounted = render(<BatteryDegradationPage />, { wrapper: Harness });
    const summary = mounted.container.querySelector('#battery-degradation-summary')!;
    expect(summary.querySelector('[data-operational-metric]')).toHaveAttribute('data-value-state', 'missing');
    expect(summary.querySelector('[data-operational-value]')).toHaveTextContent('—');
    expect(screen.getByText('Battery health is not available yet.')).toBeVisible();
    expect(screen.queryByText('Excellent', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Prediction', exact: true })).toBeVisible();
    expect(screen.getByText('Need more data points to generate prediction (minimum 3 snapshots required)')).toBeVisible();
    expect(screen.getByText('Range data will appear once history is available.')).toBeVisible();
    expect(screen.getByText('Risk data will appear once charging history is available.')).toBeVisible();
    expect(screen.getByText('Recommendations will appear based on your usage patterns.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Degradation history' })).toBeVisible();
    expect(screen.getByText('What has to happen first')).toBeVisible();
    expect(screen.getByText('Most likely reason')).toBeVisible();
    expect(screen.getByRole('link', { name: 'View charging history' })).toHaveAttribute('href', '/charging');
  });
});
