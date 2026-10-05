/** AUTHORED NOT RUN. Real panel, stats, table, charts and ErrorDisplay; fake sources only. */
import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import type { UseUnitsResult } from '@/hooks/useUnits';
import { ToastProvider } from '@/components/feedback';
import { fakeDrive, fakeQuery, fakeStats, fakeUnits } from './fixtures';
import EfficiencyPage from '../../pages/EfficiencyPage';

const H = vi.hoisted(() => ({
  stats: {} as DataStateSource<unknown>,
  drives: {} as DataStateSource<unknown>,
  units: null as UseUnitsResult | null,
  vehicle: 1 as number | null,
  start: '2026-10-01T00:00:00Z',
  end: '2026-10-04T00:00:00Z',
  statsCall: vi.fn(),
  drivesCall: vi.fn(),
  rangeCall: vi.fn(),
}));
vi.mock('@/api/hooks/useDriving', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/hooks/useDriving')>();
  return { ...actual,
    useDrivingStats: (vehicle?: string) => { H.statsCall(vehicle); return H.stats; },
    useDrives: (vehicle?: string) => { H.drivesCall(vehicle); return H.drives; },
  };
});
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => H.units }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: H.vehicle }) }));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: (options: unknown) => {
    H.rangeCall(options);
    return { startInstant: H.start, endInstantExclusive: H.end };
  },
}));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));
vi.mock('@/api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, request: vi.fn().mockResolvedValue([]) };
});
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return { ...actual, FadeIn: ({ children }: { children: ReactNode }) => <>{children}</> };
});
vi.mock('@/components/data-display', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/data-display')>();
  return { ...actual, SavedViewMenu: () => <span data-testid="saved-view-menu">Saved views</span> };
});

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <MemoryRouter initialEntries={['/efficiency']}>
    <QueryClientProvider client={client}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
  </MemoryRouter>;
}
const sectionNames = ['Key metrics', 'Overview and trend', 'Speed and temperature analysis', 'Breakdown and insights'];
const rows = () => Array.from({ length: 4 }, (_, id) => fakeDrive({ id }));
function expectSections() {
  for (const name of sectionNames) expect(screen.getByRole('region', { name })).toBeInTheDocument();
}
function tile(container: HTMLElement, group: string, label: string) {
  const strip = container.querySelector(`#${group}`)!;
  return within(strip as HTMLElement).getByLabelText(new RegExp(`^${label}:`));
}
beforeEach(() => {
  H.units = fakeUnits();
  H.stats = fakeQuery(fakeStats());
  H.drives = fakeQuery(rows());
  H.vehicle = 1;
  H.start = '2026-10-01T00:00:00Z';
  H.end = '2026-10-04T00:00:00Z';
  H.statsCall.mockClear();
  H.drivesCall.mockClear();
  H.rangeCall.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('live Efficiency closure (AUTHORED NOT RUN)', () => {
  it('retains every original section, 8+6 metrics, four charts, table, glossary and saved-view action', () => {
    const { container } = render(<EfficiencyPage />, { wrapper: Providers });
    expectSections();
    expect(container.querySelectorAll('#efficiency-kpis [data-stat]')).toHaveLength(8);
    expect(container.querySelectorAll('#efficiency-insights [data-stat]')).toHaveLength(6);
    expect(container.querySelectorAll('figure')).toHaveLength(4);
    for (const name of ['Efficiency overview', 'Energy insights', 'Efficiency by temperature range'])
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    expect(screen.getByTestId('efficiency-glossary-strip')).toBeInTheDocument();
    expect(screen.getByTestId('saved-view-menu')).toBeInTheDocument();
    expect(screen.getAllByText('Lifetime driving summary')).toHaveLength(2);
    expect(H.statsCall).toHaveBeenLastCalledWith('1');
    expect(H.drivesCall).toHaveBeenLastCalledWith('1');
    expect(H.rangeCall).toHaveBeenLastCalledWith({ persistKey: 'efficiency.range' });
    expect(tile(container, 'efficiency-kpis', 'Avg consumption')).toHaveTextContent('Wh/km');
    expect(tile(container, 'efficiency-kpis', 'Total distance')).toHaveTextContent('5,000');
    expect(screen.queryByRole('combobox', { name: /vehicle|date range/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Export chart' })).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Add annotation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide annotations' })).toBeInTheDocument();
    // Original sites never enabled fullscreen. Keep that default, do not invent new actions.
    expect(screen.queryByRole('button', { name: 'Enter fullscreen' })).not.toBeInTheDocument();
  });
  it('changes units/locale/precision on rerender without changing source or preference identities', () => {
    const { container, rerender } = render(<EfficiencyPage />, { wrapper: Providers });
    const originalStats = H.stats.data;
    H.units = fakeUnits(true, 3, 'de-DE');
    rerender(<EfficiencyPage />);
    expectSections();
    expect(H.stats.data).toBe(originalStats);
    expect(tile(container, 'efficiency-kpis', 'Avg consumption')).toHaveTextContent('Wh/mi');
    expect(tile(container, 'efficiency-kpis', 'Avg speed')).toHaveTextContent('mph');
    expect(screen.getAllByText('68–86°F').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('#efficiency-kpis [data-stat]')).toHaveLength(8);
    expect(container.querySelectorAll('figure')).toHaveLength(4);
  });
  it('preserves genuine numeric zeros, but never converts absent/NaN/Infinity/string measurements to zero', () => {
    H.stats = fakeQuery(fakeStats({ totalDrives: 0, totalDistanceKm: 0,
      avgEfficiencyWhKm: 0, avgSpeedKmh: 0, topSpeedKmh: 0,
      co2SavedKg: 0, regenRatio: 0, regenEnergyWh: 0, totalDurationS: 0 }));
    const { container, rerender } = render(<EfficiencyPage />, { wrapper: Providers });
    expect(tile(container, 'efficiency-kpis', 'Drives analyzed')).toHaveAttribute('data-state', 'value');
    expect(tile(container, 'efficiency-insights', 'Total regen')).toHaveTextContent('0');
    expect(tile(container, 'efficiency-insights', 'Regen ratio')).toHaveTextContent('0');
    expect(tile(container, 'efficiency-kpis', 'Est. cost/km')).toHaveAttribute('data-state', 'missing');
    H.stats = fakeQuery({ totalDrives: undefined, totalDistanceKm: Infinity,
      avgEfficiencyWhKm: NaN, avgSpeedKmh: '0', topSpeedKmh: null });
    rerender(<EfficiencyPage />);
    expectSections();
    for (const label of ['Drives analyzed', 'Total distance', 'Avg consumption', 'Avg speed', 'Top speed'])
      expect(tile(container, 'efficiency-kpis', label)).toHaveAttribute('data-state', 'missing');
    expect(container.querySelectorAll('#efficiency-kpis [data-stat]')).toHaveLength(8);
  });
  it('retains usable values/charts/table through stats and drives refresh failures and paused refresh', () => {
    const { container, rerender } = render(<EfficiencyPage />, { wrapper: Providers });
    const figures = Array.from(container.querySelectorAll('figure'));
    H.stats = { ...H.stats, error: new Error('summary refresh') };
    H.drives = { ...H.drives, error: new Error('history refresh') };
    rerender(<EfficiencyPage />);
    expectSections();
    expect(Array.from(container.querySelectorAll('figure'))).toEqual(figures);
    expect(container.querySelectorAll('#efficiency-kpis [data-stat]')).toHaveLength(8);
    expect(screen.getAllByText('20–30°C').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('stale-refresh-warning').length).toBeGreaterThan(0);
    H.drives = { ...H.drives, error: null, fetchStatus: 'paused' };
    rerender(<EfficiencyPage />);
    expect(screen.getAllByText('The device is offline, so this section is showing the last values it received.').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('figure')).toHaveLength(4);
  });
  it.each(['stats', 'drives'] as const)('isolates initial %s failure from the independently healthy neighbor', source => {
    H[source] = fakeQuery(undefined, { error: new Error('initial failure'), isError: true });
    const { container } = render(<EfficiencyPage />, { wrapper: Providers });
    expectSections();
    expect(container.querySelectorAll('figure')).toHaveLength(4);
    if (source === 'stats') expect(screen.getAllByText('20–30°C').length).toBeGreaterThan(0);
    else expect(container.querySelectorAll('#efficiency-kpis [data-stat]')).toHaveLength(8);
  });
  it.each(['loading', 'unknown', 'empty', 'malformed'] as const)('keeps the complete panel closure for %s sources', kind => {
    const query = kind === 'loading' ? fakeQuery(undefined, { isLoading: true })
      : kind === 'unknown' ? fakeQuery()
        : kind === 'empty' ? fakeQuery([])
          : fakeQuery({ unexpectedEnvelope: true });
    H.drives = query;
    H.stats = kind === 'empty' ? fakeQuery(null) : query;
    H.vehicle = kind === 'unknown' ? null : 1;
    const { container, rerender } = render(<EfficiencyPage />, { wrapper: Providers });
    expectSections();
    expect(container.querySelectorAll('figure')).toHaveLength(4);
    expect(screen.getByRole('heading', { name: 'Efficiency overview' })).toBeInTheDocument();
    H.stats = fakeQuery(fakeStats());
    H.drives = fakeQuery(rows());
    H.vehicle = 8;
    rerender(<EfficiencyPage />);
    expectSections();
    expect(H.drivesCall).toHaveBeenLastCalledWith('8');
    expect(H.statsCall).toHaveBeenLastCalledWith('8');
  });
  it('preserves half-open boundaries and leaves lifetime stats independent of the workspace window', () => {
    H.drives = fakeQuery(rows().map((d, i) => ({ ...d, startTs: i < 2 ? H.start : H.end })));
    const { container, rerender } = render(<EfficiencyPage />, { wrapper: Providers });
    const lifetime = tile(container, 'efficiency-kpis', 'Total distance').textContent;
    expect(screen.getAllByText('20–30°C').length).toBeGreaterThan(0);
    H.start = H.end;
    rerender(<EfficiencyPage />);
    expectSections();
    expect(screen.queryByText('20–30°C')).not.toBeInTheDocument();
    expect(tile(container, 'efficiency-kpis', 'Total distance').textContent).toBe(lifetime);
    expect(container.querySelectorAll('figure')).toHaveLength(4);
  });
  it('keeps all six original temperature fields in the real mobile table detail modal', () => {
    const observers = new Map<Element, ResizeObserverCallback>();
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) { observers.set(element, this.callback); }
      disconnect() {}
      unobserve() {}
    });
    const { container, rerender } = render(<EfficiencyPage />, { wrapper: Providers });
    const frame = container.querySelector('[data-grid-frame]')!;
    act(() => observers.get(frame)?.([
      { target: frame, contentRect: { width: 390 } } as ResizeObserverEntry,
    ], {} as ResizeObserver));
    expect(container.querySelector('[data-mobile-table]')).not.toBeNull();
    expect(container.querySelector('[data-card-primary]')).toHaveTextContent('150 Wh/km');
    fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
    const dialog = screen.getByRole('dialog');
    for (const label of ['Temp range', 'Drives', 'Avg Wh/km', 'km/kWh', 'Total km', 'Avg speed'])
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    expect(within(dialog).getByText('200')).toBeInTheDocument();
    expect(within(dialog).getByText('72 km/h')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    H.drives = { ...H.drives, error: new Error('retained mobile rows') };
    rerender(<EfficiencyPage />);
    expect(container.querySelector('[data-card-primary]')).toHaveTextContent('150 Wh/km');
  });
});
