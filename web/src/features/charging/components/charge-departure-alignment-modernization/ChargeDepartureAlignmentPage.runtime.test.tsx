/** AUTHORED_NOTRUN: parent owns the serialized runtime validation window. */
import { createElement, type ComponentProps, type PropsWithChildren } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageContainer } from '@/components/layout';
import type { FadeIn } from '@/components/motion';
import type { DataStateSource } from '@/api/dataState';
import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';
import {
  getFormatterPreferences, setGlobalLocale, setGlobalPrecision,
} from '@/lib/numberFormat';
import { formatDurationSecondsAsMinutes } from '@/lib/dateFormat';
import { analyzeChargeDepartureAlignment } from '../../lib/chargeDepartureAlignment';
import ChargeDepartureAlignmentPage from '../../pages/ChargeDepartureAlignmentPage';

const source = vi.hoisted(() => ({
  sessions: {} as DataStateSource<ChargingSession[]>,
  drives: {} as DataStateSource<Drive[]>,
  vehicleId: 7 as number | null,
  chargeHook: vi.fn(),
  driveHook: vi.fn(),
  chargeRetry: vi.fn(),
  driveRetry: vi.fn(),
}));
vi.mock('@/api/hooks/useCharging', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useCharging')>(),
  useChargingHistory: (vehicleId?: string) => {
    source.chargeHook(vehicleId);
    return source.sessions;
  },
}));
vi.mock('@/api/hooks/useDriving', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useDriving')>(),
  useDriveHistory: (vehicleId?: string) => {
    source.driveHook(vehicleId);
    return source.drives;
  },
}));
vi.mock('@/hooks/useSelectedVehicle', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSelectedVehicle')>(),
  useSelectedVehicle: () => ({ vehicleId: source.vehicleId }),
}));
vi.mock('@/components/layout', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/layout')>(),
  PageContainer: ({ title, children, className }: ComponentProps<typeof PageContainer>) =>
    createElement('main', { className }, createElement('h1', null, title), children),
}));
vi.mock('@/components/motion', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/motion')>(),
  FadeIn: ({ children, className }: ComponentProps<typeof FadeIn>) =>
    createElement('div', { className }, children),
}));
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const passthrough = ({ children }: PropsWithChildren) => <>{children}</>;
  return {
    ...actual,
    // Keep ChartContainer's state, export, accessible table and fullscreen real.
    // Actual SVG geometry/legend payload remain browser acceptance work.
    ResponsiveContainer: passthrough,
    ComposedChart: passthrough,
    Bar: () => null,
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    ChartLegend: () => null,
  };
});

function session(index: number, overrides: Partial<ChargingSession> = {}): ChargingSession {
  const started = new Date(Date.UTC(2026, 8, index + 1, 8)).toISOString();
  return {
    id: `charge-${index}`, vehicle_id: '7', charger_type: 'AC',
    start_soc_pct: 20, end_soc_pct: 80, total_energy_added_wh: 14_000,
    peak_power_w: 7_000, cost_decimal: null, started_at: started,
    start_ts: started, startedAt: started, duration_min: 60,
    ended_at: new Date(Date.parse(started) + 3_600_000).toISOString(),
    ...overrides,
  };
}
function drive(index: number, overrides: Partial<Drive> = {}): Drive {
  const startTs = new Date(Date.UTC(2026, 8, index + 1, 10)).toISOString();
  return {
    id: index + 100, vehicleId: 7, startTs,
    endTs: new Date(Date.parse(startTs) + 1_800_000).toISOString(),
    durationS: 1_800, distanceM: 12_000,
    startAddress: null, endAddress: null,
    startLat: null, startLon: null, endLat: null, endLon: null,
    startBatteryPct: 79, endBatteryPct: 65.125,
    energyUsedWh: 3_000, regenEnergyWh: null,
    avgSpeedMps: null, maxSpeedMps: null, avgPowerW: null,
    outsideTempAvgC: null, insideTempAvgC: null, score: null,
    endedStatus: null, createdAt: startTs, updatedAt: startTs,
    ...overrides,
  };
}
const charges = Array.from({ length: 15 }, (_, index) => session(index));
const drives = Array.from({ length: 15 }, (_, index) => drive(index));
const originalPreferences = getFormatterPreferences();
function LocationProbe() {
  return <output data-testid="alignment-search">{useLocation().search}</output>;
}
function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/charge-departure-alignment?existing=kept&hidden_charge-departure-alignment=margin']}>
        {children}<LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>;
  }
  // This wrapper is stable for the returned view's rerenders.
  return render(<ChargeDepartureAlignmentPage />, { wrapper: Harness });
}
function tiles(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-stat]'));
}
function figure() {
  return screen.getByRole('figure', {
    name: 'Dwell Time vs. Readiness Margin',
  });
}
function pairsHeading() {
  return screen.getByText('Recent Pairs', { selector: 'h3', exact: true });
}
function sourcePanel(container: HTMLElement, id: string) {
  const panel = container.querySelector<HTMLElement>(`[data-alignment-source="${id}"]`);
  if (!panel) throw new Error(`Missing source panel: ${id}`);
  return panel;
}

beforeEach(() => {
  source.chargeHook.mockReset();
  source.driveHook.mockReset();
  source.chargeRetry.mockReset();
  source.driveRetry.mockReset();
  source.vehicleId = 7;
  source.sessions = {
    data: charges, isLoading: false, fetchStatus: 'idle',
    dataUpdatedAt: 1, refetch: source.chargeRetry,
  };
  source.drives = {
    data: drives, isLoading: false, fetchStatus: 'idle',
    dataUpdatedAt: 1, refetch: source.driveRetry,
  };
  localStorage.clear();
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setGlobalLocale(originalPreferences.locale);
  setGlobalPrecision(originalPreferences.precision);
});

describe('Charge departure modernization (AUTHORED_NOTRUN)', () => {
  it('preserves four original metrics, hints, precision, history bounds and chart identity', () => {
    const result = mountPage();
    const summary = analyzeChargeDepartureAlignment(charges, drives);
    expect(source.chargeHook).toHaveBeenLastCalledWith('7');
    expect(source.driveHook).toHaveBeenLastCalledWith('7');
    const stats = tiles(result.container);
    expect(stats.map(tile => tile.querySelector('[data-stat-label]')?.textContent)).toEqual([
      'Avg. Dwell Time', 'Avg. Readiness Margin', 'Misaligned Rate', 'Paired Sessions',
    ]);
    expect(stats[0]?.querySelector('[data-stat-value]'))
      .toHaveTextContent(formatDurationSecondsAsMinutes(summary.avgDwellS));
    expect(stats[1]?.querySelector('[data-stat-value]')).toHaveTextContent('65.10');
    expect(stats[2]?.querySelector('[data-stat-context]')).toHaveTextContent('15 of 15 paired sessions');
    expect(stats[3]?.querySelector('[data-stat-context]')).toHaveTextContent('of 15 ended charges within 24h of a drive');
    expect(result.container.querySelector('[data-layout-reference]')).toHaveClass('w-full', 'min-w-0');
    expect(result.container.querySelector('[data-stat-strip]')).toHaveAttribute('data-period-kind', 'unknown');
    expect(screen.getByText(/not complete lifetime coverage/)).toBeInTheDocument();
    expect(screen.getByText(/Pairing and flags are model-derived/)).toBeInTheDocument();
    expect(result.container.querySelector('[data-alignment-bounds="charging-history"]'))
      .toHaveTextContent(new Date(charges[0]!.ended_at!).toLocaleString('en'));
    expect(result.container.querySelector('[data-alignment-bounds="drive-history"]'))
      .toHaveTextContent('15 valid timestamps');
    expect(figure()).toBeInTheDocument();
    expect(screen.getByTestId('alignment-search')).toHaveTextContent('existing=kept');
    expect(screen.getByTestId('alignment-search')).toHaveTextContent('hidden_charge-departure-alignment=margin');
    expect(screen.queryByRole('combobox', { name: /Vehicle|Date range|Time range/ })).not.toBeInTheDocument();
  });

  it('keeps all loaded pairs reachable beyond the original twelve and every field in desktop columns', () => {
    mountPage();
    const table = screen.getByRole('table', { name: 'Recent Pairs' });
    const expected = [
      'Charge ended', 'Drive started', 'Dwell (min)', 'Readiness margin',
      'SoC that drive used', 'Charge-end SoC', 'Drive-start SoC', 'Drive-end SoC',
      'SoC drift', 'Already-full dwell (min)', 'Pairing signals', 'Charge ID', 'Drive ID',
    ];
    for (const header of expected) {
      expect(within(table).getByRole('columnheader', { name: new RegExp(header.replace(/[()]/g, '\\$&')) })).toBeInTheDocument();
    }
    expect(within(table).getAllByRole('row')).toHaveLength(13);
    expect(within(table).getByText('charge-14')).toBeInTheDocument();
    expect(within(table).queryByText('charge-0')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page' }), { target: { value: '24' } });
    expect(within(table).getByText('charge-0')).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(16);
  });

  it('uses actual locale/precision for percentages without changing rounded-minute duration', () => {
    setGlobalLocale('de-DE');
    setGlobalPrecision(3);
    const result = mountPage();
    expect(tiles(result.container)[1]?.querySelector('[data-stat-value]')).toHaveTextContent('65,100');
    const table = screen.getByRole('table', { name: 'Recent Pairs' });
    expect(within(table).getAllByText('65,125%').length).toBeGreaterThan(0);
    expect(tiles(result.container)[0]?.querySelector('[data-stat-value]'))
      .toHaveTextContent(formatDurationSecondsAsMinutes(3_600));
  });

  it('preserves chart accessible rows, scalar columns and original image-export actions', () => {
    mountPage();
    const chart = figure();
    const table = within(chart).getByRole('table');
    for (const label of ['Date', 'Dwell (min)', 'Readiness margin (%)']) {
      expect(within(table).getByRole('columnheader', { name: label, exact: true })).toBeInTheDocument();
    }
    expect(within(table).getAllByRole('row')).toHaveLength(16);
    expect(within(table).queryByRole('columnheader', { name: 'misaligned' })).not.toBeInTheDocument();
    fireEvent.click(within(chart).getByRole('button', { name: 'Export chart', exact: true }));
    const menu = within(chart).getByRole('menu', { name: 'Export chart', exact: true });
    for (const name of ['Save as PNG', 'Save as SVG', 'Copy image to clipboard']) {
      expect(within(menu).getByRole('menuitem', { name, exact: true })).toBeInTheDocument();
    }
    // Original page passed data (accessible table), not exportData (CSV).
    // Do not claim or invent a previously unwired export/fullscreen/annotation action.
    expect(within(menu).queryByRole('menuitem', { name: 'Download data as CSV' })).not.toBeInTheDocument();
    expect(within(chart).queryByRole('button', { name: /fullscreen|annotation/i })).not.toBeInTheDocument();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(within(chart).queryByRole('menu')).not.toBeInTheDocument();
  });

  it('shows unknown instead of zero for missing denominators while keeping all shells', () => {
    source.sessions.data = [];
    source.drives.data = [];
    const result = mountPage();
    const stats = tiles(result.container);
    expect(stats).toHaveLength(4);
    expect(stats[0]?.querySelector('[data-stat-value]')).toHaveTextContent('—');
    expect(stats[1]?.querySelector('[data-stat-value]')).toHaveTextContent('—');
    expect(stats[2]?.querySelector('[data-stat-value]')).toHaveTextContent('—');
    expect(stats[3]?.querySelector('[data-stat-value]')).toHaveTextContent('0');
    expect(figure()).toBeInTheDocument();
    expect(pairsHeading()).toBeInTheDocument();
    expect(screen.getAllByText('No paired sessions to show yet.').length).toBeGreaterThan(0);
  });

  it('does not infer a zero readiness margin from a missing drive-end reading', () => {
    source.drives.data = drives.map(row => ({ ...row, endBatteryPct: null }));
    const result = mountPage();
    expect(tiles(result.container)[1]?.querySelector('[data-stat-value]')).toHaveTextContent('—');
    expect(screen.getByText('No paired drive has a recorded end SoC.')).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Recent Pairs' })).getAllByText('—').length).toBeGreaterThan(0);
  });

  it.each(['charging-history', 'drive-history'])('retains rows on %s refresh failure and retries only that source', id => {
    const query = id === 'charging-history' ? source.sessions : source.drives;
    query.error = new Error('private upstream failure details');
    query.isError = true;
    const result = mountPage();
    expect(tiles(result.container)[3]?.querySelector('[data-stat-value]')).toHaveTextContent('15');
    expect(screen.getByRole('table', { name: 'Recent Pairs' })).toBeInTheDocument();
    expect(figure()).toBeInTheDocument();
    expect(screen.queryByText('private upstream failure details')).not.toBeInTheDocument();
    fireEvent.click(within(sourcePanel(result.container, id)).getByRole('button', { name: 'Refresh' }));
    expect(id === 'charging-history' ? source.chargeRetry : source.driveRetry).toHaveBeenCalledTimes(1);
    expect(id === 'charging-history' ? source.driveRetry : source.chargeRetry).not.toHaveBeenCalled();
  });

  it.each(['charging-history', 'drive-history'])('handles fatal %s failure without hiding the other source bounds', id => {
    if (id === 'charging-history') {
      source.sessions = { error: new Error('sensitive backend detail'), isError: true, refetch: source.chargeRetry };
    } else {
      source.drives = { error: new Error('sensitive backend detail'), isError: true, refetch: source.driveRetry };
    }
    const result = mountPage();
    expect(tiles(result.container)).toHaveLength(4);
    expect(tiles(result.container)[3]?.querySelector('[data-stat-value]')).toHaveTextContent('—');
    expect(figure()).toBeInTheDocument();
    expect(pairsHeading()).toBeInTheDocument();
    expect(screen.queryByText('sensitive backend detail')).not.toBeInTheDocument();
    const healthyId = id === 'charging-history' ? 'drive-history' : 'charging-history';
    expect(result.container.querySelector(`[data-alignment-bounds="${healthyId}"]`)).toHaveTextContent('15 records loaded');
    fireEvent.click(within(sourcePanel(result.container, id)).getByRole('button', { name: 'Retry' }));
    expect(id === 'charging-history' ? source.chargeRetry : source.driveRetry).toHaveBeenCalledTimes(1);
    expect(id === 'charging-history' ? source.driveRetry : source.chargeRetry).not.toHaveBeenCalled();
  });

  it('keeps cached pair metrics and rows during paused refresh and resumes independently', () => {
    source.sessions.fetchStatus = 'paused';
    source.drives.isFetching = true;
    const result = mountPage();
    expect(tiles(result.container)[3]?.querySelector('[data-stat-value]')).toHaveTextContent('15');
    expect(screen.getByRole('table', { name: 'Recent Pairs' })).toBeInTheDocument();
    const warning = sourcePanel(result.container, 'charging-history');
    expect(within(warning).getByText(/last values it received/)).toBeInTheDocument();
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(source.chargeRetry).toHaveBeenCalledTimes(1);
    expect(source.driveRetry).not.toHaveBeenCalled();
    source.sessions.fetchStatus = 'idle';
    source.drives.isFetching = false;
    result.rerender(<ChargeDepartureAlignmentPage />);
    expect(within(sourcePanel(result.container, 'charging-history')).queryByTestId('stale-refresh-warning'))
      .not.toBeInTheDocument();
    expect(screen.getByTestId('alignment-search')).toHaveTextContent('hidden_charge-departure-alignment=margin');
  });

  it('handles initial loading, paused initial loading and recovery with one persistent Router', () => {
    source.sessions = { isLoading: true, refetch: source.chargeRetry };
    source.drives = { isLoading: true, refetch: source.driveRetry };
    const result = mountPage();
    expect(tiles(result.container).every(tile => tile.getAttribute('data-state') === 'loading')).toBe(true);
    expect(figure()).toBeInTheDocument();
    expect(pairsHeading()).toBeInTheDocument();
    source.sessions = { fetchStatus: 'paused', refetch: source.chargeRetry };
    source.drives = { fetchStatus: 'paused', refetch: source.driveRetry };
    result.rerender(<ChargeDepartureAlignmentPage />);
    expect(screen.getAllByText('History loading is paused. Connect to resume or retry this source.')).toHaveLength(2);
    fireEvent.click(within(sourcePanel(result.container, 'drive-history')).getByRole('button', { name: 'Retry' }));
    expect(source.driveRetry).toHaveBeenCalledTimes(1);
    source.sessions = { data: charges, refetch: source.chargeRetry };
    source.drives = { data: drives, refetch: source.driveRetry };
    result.rerender(<ChargeDepartureAlignmentPage />);
    expect(screen.getByRole('table', { name: 'Recent Pairs' })).toBeInTheDocument();
    expect(screen.getByTestId('alignment-search')).toHaveTextContent('existing=kept');
  });

  it('exposes full mobile details for every field and can close the modal', async () => {
    const observers: Array<{ callback: ResizeObserverCallback; elements: Element[] }> = [];
    class Observer {
      record: typeof observers[number];
      constructor(callback: ResizeObserverCallback) {
        this.record = { callback, elements: [] };
        observers.push(this.record);
      }
      observe(element: Element) { this.record.elements.push(element); }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', Observer);
    const result = mountPage();
    // Trigger only DataTable's allocated-width observer, not chart observers.
    const frame = result.container.querySelector('[data-grid-frame]');
    const observer = observers.find(item => item.elements.includes(frame!));
    expect(observer).toBeDefined();
    const { act } = await import('@testing-library/react');
    act(() => {
      observer!.callback([{ target: frame, contentRect: { width: 390 } } as ResizeObserverEntry], {} as ResizeObserver);
    });
    await waitFor(() => expect(result.container.querySelector('[data-mobile-table]')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'Quick view' })[0]!);
    const modal = screen.getByRole('dialog');
    for (const text of [
      'Charge ended', 'Drive started', 'Dwell (min)', 'Readiness margin',
      'SoC that drive used', 'Charge-end SoC', 'Drive-start SoC', 'Drive-end SoC',
      'SoC drift', 'Already-full dwell (min)', 'Pairing signals', 'Charge ID', 'Drive ID',
    ]) expect(within(modal).getByText(text, { exact: true })).toBeInTheDocument();
    expect(within(modal).getByText('charge-14')).toBeInTheDocument();
    // Modal owns an icon Close and a footer Close; select the text-bearing footer.
    fireEvent.click(within(modal).getByText('Close', { selector: 'button' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps no-vehicle onboarding without requesting a different history scope', () => {
    source.vehicleId = null;
    mountPage();
    expect(source.chargeHook).toHaveBeenLastCalledWith(undefined);
    expect(source.driveHook).toHaveBeenLastCalledWith(undefined);
    expect(screen.queryByRole('table', { name: 'Recent Pairs' })).not.toBeInTheDocument();
  });
});
