import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { ChargingSession } from '@/api/types';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSettings } from '@/hooks/useSettings';
import { useChargingSessionsPaginated } from '@/api/hooks/useCharging';
import ChargingHeatmapPage from '../../pages/ChargingHeatmapPage';

// Authored for parent execution. Keep real Router, layout, stats, chart and grid.
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/hooks/useRangeState', () => ({ useRangeState: vi.fn() }));
vi.mock('@/hooks/useSettings', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useSettings')>();
  return { ...actual, useSettings: vi.fn() };
});
vi.mock('@/api/hooks/useCharging', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/hooks/useCharging')>();
  return { ...actual, useChargingSessionsPaginated: vi.fn() };
});
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return { ...actual, FadeIn: ({ children, className }: import('@/components/motion').FadeInProps) =>
    <div className={className}>{children}</div> };
});

const retry = vi.fn();
const savedPreferences = getFormatterPreferences();
const savedFullscreenEnabled = Object.getOwnPropertyDescriptor(document, 'fullscreenEnabled');

function setQuery(overrides: Record<string, unknown> = {}) {
  vi.mocked(useChargingSessionsPaginated).mockReturnValue({
    data: [], error: null, isLoading: false, isPending: false, isError: false,
    isFetching: false, isStale: false, status: 'success', fetchStatus: 'idle',
    dataUpdatedAt: 1_790_000_000_000, errorUpdatedAt: 0, refetch: retry,
    ...overrides,
  } as ReturnType<typeof useChargingSessionsPaginated>);
}

function setScope(vehicleId = 7, start = '2026-01-01', end = '2026-03-01') {
  vi.mocked(useSelectedVehicle).mockReturnValue({ vehicleId } as ReturnType<typeof useSelectedVehicle>);
  vi.mocked(useRangeState).mockReturnValue({ start, end } as ReturnType<typeof useRangeState>);
}

function setSettings(precision = 2, locale = 'en-US', symbol = '$') {
  vi.mocked(useSettings).mockReturnValue({
    settings: { decimal_precision: precision, locale, currency_symbol: symbol,
      unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar' },
    settingsUnavailable: false,
  } as ReturnType<typeof useSettings>);
  setGlobalPrecision(precision);
  setGlobalLocale(locale);
}

function session(id: number, extra: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id, vehicle_id: 7, started_at: '2026-01-05T10:00:00',
    ended_at: '2026-01-05T12:00:00', start_soc_pct: 20, end_soc_pct: 70,
    delta_soc_pct: 50, start_odometer_m: null, end_odometer_m: null,
    start_lat: null, start_lng: null, start_place: 'Home',
    total_energy_added_wh: 12000, peak_power_w: null, avg_power_w: null,
    cost_decimal: 3, cost_currency: null, charger_type: null, cable_type: null,
    startedAt: '2026-01-05T10:00:00', duration_min: 120, ...extra,
  };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={['/charging-heatmap']}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>;
  }
  // RTL's wrapper remains mounted across rerender; route/query state is not reset.
  return { ...render(<ChargingHeatmapPage />, { wrapper: Wrapper }), client };
}

function metric(container: HTMLElement, id: string) {
  const keys: Record<string, string> = {
    'charge.sessions': 'charging-heatmap-total-sessions',
    'charge.energyAdded': 'charging-heatmap-total-energy',
    'charge.recordedCost': 'charging-heatmap-total-cost',
    'charge.avgDuration': 'charging-heatmap-average-duration',
  };
  const tile = container.querySelector(`[data-operational-metric="${keys[id]}"]`);
  expect(tile).not.toBeNull();
  return tile as HTMLElement;
}

function expectPanels(container: HTMLElement) {
  const cards = container.querySelectorAll<HTMLElement>('[data-card]');
  expect(cards).toHaveLength(4);
  const titles = ['Weekly Charging Heatmap', 'Charging Insights', 'Top Charging Locations', 'Sessions by Day of Week'];
  for (const [index, title] of titles.entries()) {
    const card = cards[index];
    expect(card).toBeDefined();
    // The real embedded figure also owns an accessible heading with this name.
    // Assert the panel's own header, not an arbitrary match in its chart content.
    const header = card.querySelector<HTMLElement>(':scope > header');
    expect(header).not.toBeNull();
    const heading = within(header as HTMLElement).getByRole('heading', { name: title });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveAttribute('data-card-title');
    expect(card).toHaveAttribute('aria-labelledby', heading.id);
  }
  expect(container.querySelector('#charging-heatmap-when')).not.toBeNull();
  expect(container.querySelector('#charging-heatmap-breakdowns')).not.toBeNull();
}

beforeEach(() => {
  void vi.mocked(useSelectedVehicle).mockReset();
  void vi.mocked(useRangeState).mockReset();
  void vi.mocked(useSettings).mockReset();
  void vi.mocked(useChargingSessionsPaginated).mockReset();
  void retry.mockReset();
  setScope();
  setSettings();
  setQuery();
});

afterEach(() => {
  cleanup();
  if (savedFullscreenEnabled) {
    Object.defineProperty(document, 'fullscreenEnabled', savedFullscreenEnabled);
  } else {
    Reflect.deleteProperty(document, 'fullscreenEnabled');
  }
  setGlobalPrecision(savedPreferences.precision);
  setGlobalLocale(savedPreferences.locale);
});

describe('Charging Patterns live modernization — parent runtime acceptance NOTRUN', () => {
  it('retains all four metrics, 168 density cells, tooltip energy, legend and insight labels', () => {
    setQuery({ data: [session(1), session(2)] });
    const { container } = mount();
    expectPanels(container);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(metric(container, 'charge.sessions')).toHaveTextContent('2');
    expect(metric(container, 'charge.energyAdded')).toHaveTextContent('24.00 kWh');
    expect(metric(container, 'charge.recordedCost')).toHaveTextContent('$6.00');
    expect(metric(container, 'charge.avgDuration')).toHaveTextContent('2.00 h');
    const grid = screen.getByRole('img', { name: 'Charging sessions by weekday and hour of day' });
    expect(grid.querySelectorAll('[title]')).toHaveLength(168);
    const populated = grid.querySelector('[title="Mon 10:00 — 2 sessions"]');
    expect(populated).not.toBeNull();
    fireEvent.mouseEnter(populated as HTMLElement);
    expect(within(grid).getByText('2 sessions · 24.00 kWh')).toBeInTheDocument();
    expect(screen.getByText('Less')).toBeInTheDocument();
    expect(screen.getByText('More')).toBeInTheDocument();
    for (const label of ['Favorite Charging Time', 'Busiest Day', 'Busiest Hour', 'Weekdays', 'Weekends']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(container.querySelectorAll('figure')).toHaveLength(2);
  });

  it('preserves the mounted grid and summary through a failed refresh, pause and recovery', () => {
    const data = [session(1), session(2)];
    setQuery({ data });
    const { container, rerender } = mount();
    const grid = screen.getByRole('img', { name: 'Charging sessions by weekday and hour of day' });
    setQuery({ data, isError: true, status: 'error', error: new Error('refresh failed') });
    rerender(<ChargingHeatmapPage />);
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Charging sessions by weekday and hour of day' })).toBe(grid);
    expect(metric(container, 'charge.energyAdded')).toHaveTextContent('24.00 kWh');
    expectPanels(container);
    setQuery({ data, fetchStatus: 'paused' });
    rerender(<ChargingHeatmapPage />);
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('offline');
    expect(grid.querySelectorAll('[title]')).toHaveLength(168);
    setQuery({ data });
    rerender(<ChargingHeatmapPage />);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it('keeps shells during initial loading, fatal failure, pause and successful empty data', () => {
    setQuery({ data: undefined, isLoading: true, isPending: true, fetchStatus: 'fetching' });
    const { container, rerender } = mount();
    expectPanels(container);
    const summary = screen.getByRole('region', { name: 'Charging summary' });
    expect(summary.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(summary.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(summary.querySelectorAll('[data-operational-metric] [aria-hidden="true"]')).toHaveLength(4);
    setQuery({ data: undefined, isError: true, error: new Error('sessions down') });
    rerender(<ChargingHeatmapPage />);
    expectPanels(container);
    fireEvent.click(within(summary).getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    setQuery({ data: undefined, fetchStatus: 'paused', isPending: true });
    rerender(<ChargingHeatmapPage />);
    expectPanels(container);
    expect(screen.getByText(/Loading is paused/)).toBeInTheDocument();
    setQuery({ data: [] });
    rerender(<ChargingHeatmapPage />);
    expectPanels(container);
    expect(metric(container, 'charge.sessions')).toHaveAttribute('data-value-state', 'value');
    expect(metric(container, 'charge.sessions').querySelector('[data-operational-value]')).toHaveTextContent('0');
    expect(metric(container, 'charge.energyAdded')).toHaveAttribute('data-value-state', 'missing');
    expect(metric(container, 'charge.avgDuration')).toHaveAttribute('data-value-state', 'missing');
  });

  it('distinguishes recorded zero cost/energy from missing cost and unfinished duration', () => {
    setQuery({ data: [session(1, { total_energy_added_wh: 0, cost_decimal: 0, ended_at: null })] });
    const { container, rerender } = mount();
    expect(metric(container, 'charge.energyAdded')).toHaveAttribute('data-value-state', 'value');
    expect(metric(container, 'charge.recordedCost')).toHaveTextContent('$0.00');
    expect(metric(container, 'charge.avgDuration')).toHaveAttribute('data-value-state', 'missing');
    setQuery({ data: [session(1, { total_energy_added_wh: 0, cost_decimal: null, ended_at: null })] });
    rerender(<ChargingHeatmapPage />);
    expect(metric(container, 'charge.recordedCost')).toHaveAttribute('data-value-state', 'missing');
    expect(metric(container, 'charge.recordedCost').querySelector('[data-operational-value]')).toHaveTextContent('—');
  });

  it('retains the positive completed-duration denominator and recorded-only cost total', () => {
    setQuery({ data: [session(1), session(2, { ended_at: null, cost_decimal: null }),
      session(3, { ended_at: '2026-01-05T10:00:00', cost_decimal: 0 })] });
    const { container } = mount();
    expect(metric(container, 'charge.sessions')).toHaveTextContent('3');
    expect(metric(container, 'charge.avgDuration')).toHaveTextContent('2.00 h');
    expect(metric(container, 'charge.energyAdded')).toHaveTextContent('36.00 kWh');
    expect(metric(container, 'charge.recordedCost')).toHaveTextContent('$3.00');
    expect(metric(container, 'charge.recordedCost').querySelector(':scope > div:last-child')).toHaveTextContent('recorded values only');
  });

  it('keeps exact query operands on persistent scope rerender and adds no local selectors', () => {
    const { rerender } = mount();
    expect(useChargingSessionsPaginated).toHaveBeenLastCalledWith(7, { limit: 2000, start: '2026-01-01', end: '2026-03-01' });
    setScope(9, '2026-02-01', '2026-04-01');
    rerender(<ChargingHeatmapPage />);
    expect(useChargingSessionsPaginated).toHaveBeenLastCalledWith(9, { limit: 2000, start: '2026-02-01', end: '2026-04-01' });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('updates display preferences without changing raw SI sessions or the mounted calendar', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    const data = [session(1), session(2)];
    const bytes = JSON.stringify(data);
    setQuery({ data });
    const { container, rerender } = mount();
    const grid = screen.getByRole('img', { name: 'Charging sessions by weekday and hour of day' });
    act(() => setSettings(3, 'de-DE', '€'));
    rerender(<ChargingHeatmapPage />);
    expect(metric(container, 'charge.energyAdded')).toHaveTextContent('24,000 kWh');
    expect(metric(container, 'charge.recordedCost')).toHaveTextContent('€6,000');
    expect(screen.getByRole('img', { name: 'Charging sessions by weekday and hour of day' })).toBe(grid);
    expect(JSON.stringify(data)).toBe(bytes);
    // Controls belong to the two opted-in breakdown figures, not the calendar.
    expect(within(grid).queryByRole('button', { name: /fullscreen/i })).not.toBeInTheDocument();
    expect(within(grid).queryByRole('button', { name: /export/i })).not.toBeInTheDocument();
    const breakdownCharts = container.querySelectorAll('figure');
    expect(breakdownCharts).toHaveLength(2);
    for (const chart of breakdownCharts) {
      expect(within(chart).getByRole('button', { name: /full.?screen/i })).toBeInTheDocument();
      expect(within(chart).getByRole('button', { name: 'Export chart', exact: true })).toBeInTheDocument();
      fireEvent.click(within(chart).getByRole('button', { name: 'Export chart', exact: true }));
      const menu = within(chart).getByRole('menu', { name: 'Export chart', exact: true });
      expect(within(menu).getByRole('menuitem', { name: 'Download data as CSV' })).toBeInTheDocument();
      fireEvent.keyDown(menu, { key: 'Escape' });
      expect(within(chart).queryByRole('menu')).not.toBeInTheDocument();
    }
  });
});
