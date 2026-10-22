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
  fmtInt, fmtNumber, getFormatterPreferences, isFiniteNumber, setGlobalLocale, setGlobalPrecision,
} from '@/lib/numberFormat';
import {formatDateTime} from '@/lib/dateFormat'
import {formatDurationSecondsAsMinutes} from '@/lib/dateConvert';
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
    // The real ComposedChart renders an <svg> plot; the shared export menu
    // only offers "Save as SVG" when the figure contains one.
    ComposedChart: ({ children }: PropsWithChildren) => <svg>{children}</svg>,
    Bar: () => null,
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    ChartLegend: () => null,
  };
});

// Mirrors the page's instantLabel: the single user-zone rendering shown in
// UI rows, bounds and tooltips (no zone suffix, no ISO duplicate). The
// global timezone mock pins the zone to UTC. CSV keeps raw ISO (see below).
function instantLabel(iso: string) {
  return formatDateTime(iso, { locale: 'en-US', tz: 'UTC', clock: { second: '2-digit' } });
}

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
  return Array.from(container.querySelectorAll<HTMLElement>('[data-operational-metric]'));
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
    expect(stats.map(tile => tile.querySelector(':scope > div:first-child')?.textContent)).toEqual([
      'Avg. Dwell Time', 'Avg. Readiness Margin', 'Misaligned Rate', 'Paired Sessions',
    ]);
    expect(stats[0]?.querySelector('[data-operational-value]'))
      .toHaveTextContent(formatDurationSecondsAsMinutes(summary.avgDwellS));
    expect(stats[1]?.querySelector('[data-operational-value]')).toHaveTextContent('65.10');
    expect(stats[2]?.querySelector('[data-operational-value]')).toHaveTextContent('100.00');
    expect(stats[3]?.querySelector('[data-operational-value]')).toHaveTextContent('15');
    expect(result.container.querySelector('[data-layout-reference]')).toHaveClass('w-full', 'min-w-0');
    expect(result.container.querySelector('[data-period-kind]')).toHaveAttribute('data-period-kind', 'unknown');
    expect(result.container.querySelector('[data-alignment-bounds="charging-history"]'))
      .toHaveTextContent(instantLabel(charges[0]!.ended_at!));
    expect(result.container.querySelector('[data-alignment-bounds="drive-history"]'))
      .toHaveTextContent('15 valid timestamps');
    expect(figure()).toBeInTheDocument();
    expect(screen.getByTestId('alignment-search')).toHaveTextContent('existing=kept');
    expect(screen.getByTestId('alignment-search')).toHaveTextContent('hidden_charge-departure-alignment=margin');
    expect(screen.queryByRole('combobox', { name: /Vehicle|Date range|Time range/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details', exact: true }));
    const details = screen.getByRole('dialog', { name: 'Charge departure alignment metrics details' });
    expect(within(details).getByRole('group', { name: 'Misaligned Rate' }))
      .toHaveTextContent('15 of 15 paired sessions');
    expect(within(details).getByRole('group', { name: 'Paired Sessions' }))
      .toHaveTextContent('of 15 ended charges within 24h of a drive');
    // The drawer repeats the disclosure as its description and as the
    // What-changed narrative; pin both occurrences.
    expect(within(details).getAllByText(/Pairing and flags are model-derived/)).toHaveLength(2);
    const scopeContext = within(details).getByText('What changed', { exact: true }).parentElement;
    if (!scopeContext) throw new Error('Missing narrative scope context');
    expect(within(scopeContext).getByText(
      'Dwell is derived from recorded timestamps; readiness margin is the recorded drive-end SoC. Pairing and flags are model-derived, not measurements of charging intent.',
      { exact: true },
    )).toBeInTheDocument();
    expect(within(scopeContext).queryByText(/not complete lifetime coverage/)).not.toBeInTheDocument();
    const historyScope = 'Selected vehicle · up to 1,000 charges and 1,000 drives from the existing queries. These are loaded records, not complete lifetime coverage; the workspace date range does not filter this model.';
    const limitationsContext = within(details).getByText('Limitations', { exact: true }).parentElement;
    if (!limitationsContext) throw new Error('Missing narrative limitations context');
    expect(within(limitationsContext).getByText(historyScope, { exact: true })).toBeInTheDocument();
    const calculationDetails = within(details).getByRole('region', {
      name: 'How this was calculated', exact: true,
    });
    const provenanceContext = within(calculationDetails).getByText('Data sources', { exact: true }).closest('div');
    if (!provenanceContext) throw new Error('Missing calculation provenance context');
    expect(within(provenanceContext).getByText(historyScope, { exact: true })).toBeInTheDocument();
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
    expect(tiles(result.container)[1]?.querySelector('[data-operational-value]')).toHaveTextContent('65,100');
    const table = screen.getByRole('table', { name: 'Recent Pairs' });
    expect(within(table).getAllByText('65,125%').length).toBeGreaterThan(0);
    expect(tiles(result.container)[0]?.querySelector('[data-operational-value]'))
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
    const menu = screen.getByRole('menu', { name: 'Export chart', exact: true });
    for (const name of ['Save as PNG', 'Save as SVG', 'Copy image to clipboard']) {
      expect(within(menu).getByRole('menuitem', { name, exact: true })).toBeInTheDocument();
    }
    // The production page now explicitly supplies scalar exportData as well
    // as accessible rows; keep its data export alongside the image actions.
    expect(within(menu).getByRole('menuitem', { name: 'Download data as CSV' })).toBeInTheDocument();
    expect(within(chart).queryByRole('button', { name: /fullscreen|annotation/i })).not.toBeInTheDocument();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('shows unknown instead of zero for missing denominators while keeping all shells', () => {
    source.sessions.data = [];
    source.drives.data = [];
    const result = mountPage();
    // Face-value disclosure: the three unknown tiles are omitted while the
    // real zero paired count stays visible; the drawer counts the hidden.
    const stats = tiles(result.container);
    expect(stats).toHaveLength(1);
    expect(stats[0]?.querySelector('[data-operational-value]')).toHaveTextContent('0');
    expect(result.container.querySelector('[data-operational-metric="alignment-avg-dwell"]')).toBeNull();
    expect(result.container.querySelector('[data-operational-metric="alignment-avg-margin"]')).toBeNull();
    expect(result.container.querySelector('[data-operational-metric="alignment-misaligned-rate"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review details', exact: true }));
    const details = screen.getByRole('dialog', { name: 'Charge departure alignment metrics details' });
    expect(within(details).getByText('3 empty fields are hidden.')).toBeInTheDocument();
    expect(figure()).toBeInTheDocument();
    expect(pairsHeading()).toBeInTheDocument();
    expect(screen.getAllByText('No paired sessions to show yet.').length).toBeGreaterThan(0);
  });

  it('does not infer a zero readiness margin from a missing drive-end reading', () => {
    source.drives.data = drives.map(row => ({ ...row, endBatteryPct: null }));
    const result = mountPage();
    // Face-value disclosure: no zero is inferred — the margin tile is omitted
    // and counted in the drawer instead of rendering '—' on the face.
    expect(tiles(result.container)).toHaveLength(3);
    expect(result.container.querySelector('[data-operational-metric="alignment-avg-margin"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review details', exact: true }));
    const details = screen.getByRole('dialog', { name: 'Charge departure alignment metrics details' });
    expect(within(details).getByText('1 empty field is hidden.')).toBeInTheDocument();
    // Face-value disclosure: the drawer counts the hidden margin instead of
    // repeating its missing reason, and no zero is inferred anywhere.
    expect(within(details).queryByRole('group', { name: 'Avg. Readiness Margin' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Recent Pairs' })).getAllByText('—').length).toBeGreaterThan(0);
  });

  it.each(['charging-history', 'drive-history'])('retains rows on %s refresh failure and retries only that source', id => {
    const query = id === 'charging-history' ? source.sessions : source.drives;
    query.error = new Error('private upstream failure details');
    query.isError = true;
    const result = mountPage();
    expect(tiles(result.container)[3]?.querySelector('[data-operational-value]')).toHaveTextContent('15');
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
    // Face-value disclosure: every tile is unknown, so the face shows the
    // empty state and the drawer counts all four hidden fields.
    expect(tiles(result.container)).toHaveLength(0);
    expect(screen.getByText('No metric values are available yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details', exact: true }));
    const details = screen.getByRole('dialog', { name: 'Charge departure alignment metrics details' });
    expect(within(details).getByText('4 empty fields are hidden.')).toBeInTheDocument();
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
    expect(tiles(result.container)[3]?.querySelector('[data-operational-value]')).toHaveTextContent('15');
    expect(screen.getByRole('table', { name: 'Recent Pairs' })).toBeInTheDocument();
    const warning = sourcePanel(result.container, 'charging-history');
    expect(within(warning).getByText('The latest values are temporarily unavailable. Previously loaded data remains visible.'))
      .toBeInTheDocument();
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
    expect(result.container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(result.container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
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
    // Modal owns an icon Close and a footer Close; scope the accessible action to its footer.
    const footer = modal.querySelector<HTMLElement>('[data-modal-footer]');
    if (!footer) throw new Error('Missing mobile details footer');
    fireEvent.click(within(footer).getByRole('button', { name: 'Close', exact: true }));
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

describe('Charge departure chart flag alternatives (AUTHORED_NOTRUN)', () => {
  it('maps every existing heuristic and combined flags to scalar row status without changing date, dwell or margin', () => {
    source.sessions.data = [
      session(0),
      session(1),
      session(2),
      session(3, { start_soc_pct: 80, end_soc_pct: 95 }),
      session(4, { start_soc_pct: 70 }),
      session(5, { start_soc_pct: 70 }),
      session(6, { end_soc_pct: 95 }),
    ];
    source.drives.data = [
      drive(0, { endBatteryPct: 45 }),
      drive(1, { endBatteryPct: 10 }),
      drive(2),
      drive(3, { startBatteryPct: 94, endBatteryPct: 60 }),
      drive(4, { startTs: '2026-09-05T14:00:00.000Z', endBatteryPct: 45 }),
      drive(5, { startBatteryPct: 84, endBatteryPct: 45 }),
      drive(6, { startBatteryPct: 99, endBatteryPct: 65 }),
    ];
    const pairs = analyzeChargeDepartureAlignment(source.sessions.data, source.drives.data).pairs;
    expect(pairs.map(pair => pair.flags)).toEqual([
      [],
      ['tight_margin'],
      ['excess_buffer'],
      ['early_full_dwell'],
      ['long_dwell'],
      ['soc_mismatch'],
      ['excess_buffer', 'early_full_dwell', 'soc_mismatch'],
    ]);
    mountPage();
    const chart = figure();
    const table = within(chart).getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(within(rows[0]!).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual([
      'Date', 'Dwell (min)', 'Readiness margin (%)', 'Pairing signals',
    ]);
    expect(rows).toHaveLength(8);
    expect(rows.slice(1).map(row => within(row).getAllByRole('cell').map(cell => cell.textContent))).toEqual(
      pairs.map((pair, index) => [
        instantLabel(new Date(pair.chargeEndedMs).toISOString()),
        fmtInt(Math.round(pair.dwellS / 60)),
        isFiniteNumber(pair.readinessMarginPct) ? fmtNumber(pair.readinessMarginPct) : '—',
        index === 0 ? 'Well matched' : 'Heuristic flags, not confirmed faults',
      ]),
    );
    expect(chart).toHaveTextContent('Bars are minutes parked after charging; the line is SoC left after that drive');
    expect(chart).toHaveTextContent('Heuristic flags, not confirmed faults');
    expect(chart).toHaveAccessibleDescription(/Share of pairings that tripped at least one heuristic/);
    expect(within(chart).getByText(/Each is circumstantial on its own/)).toBeInTheDocument();
    const details = screen.getByRole('table', { name: 'Recent Pairs' });
    for (const label of [
      'Cut it close on departure', 'Added far more than that trip used',
      'Sat at full charge before leaving', 'Long gap before departure',
      'SoC reading looks inconsistent', 'Well matched',
    ]) {
      expect(within(details).getAllByText(label, { exact: true }).length).toBeGreaterThan(0);
    }
  });

  it('downloads all fifteen scalar chart rows with exact flag status and the three original CSV columns first', async () => {
    source.drives.data = drives.map((row, index) => index === 0 ? { ...row, endBatteryPct: 45 } : row);
    const pairs = analyzeChargeDepartureAlignment(charges, source.drives.data).pairs;
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:alignment-chart-csv');
    const revokeObjectURL = vi.fn();
    const NativeURL = URL;
    class DownloadURL extends NativeURL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    }
    vi.stubGlobal('URL', DownloadURL);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      mountPage();
      const chart = figure();
      fireEvent.click(within(chart).getByRole('button', { name: 'Export chart', exact: true }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Download data as CSV', exact: true }));
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(click).toHaveBeenCalledTimes(1);
      const blob = createObjectURL.mock.calls[0]![0];
      expect(blob.type).toBe('text/csv;charset=utf-8;');
      const csv = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
      });
      const lines = csv.replace(/^\ufeff/, '').split('\r\n');
      expect(lines[0]).toBe('date,dwellMin,margin,flags');
      expect(lines).toHaveLength(16);
      expect(lines.slice(1)).toEqual(pairs.map(pair => [
        // CSV keeps the full raw ISO instant (unquoted: no commas), while
        // the on-screen rows show only the friendly user-zone label.
        new Date(pair.chargeEndedMs).toISOString(),
        Math.round(pair.dwellS / 60),
        pair.readinessMarginPct,
        pair.flags.length > 0 ? '"Heuristic flags, not confirmed faults"' : 'Well matched',
      ].join(',')));
      expect(lines.join('\n')).not.toContain('misaligned');
      expect(within(within(chart).getByRole('table')).getAllByRole('row')).toHaveLength(16);
    } finally {
      click.mockRestore();
    }
  });

  it('refreshes localized flag status and header on the same mounted chart without changing pair order', async () => {
    source.drives.data = drives.map((row, index) => index === 0 ? { ...row, endBatteryPct: 45 } : row);
    const view = mountPage();
    const originalRows = within(within(figure()).getByRole('table')).getAllByRole('row').slice(1);
    const originalValues = originalRows.map(row => within(row).getAllByRole('cell').slice(0, 3).map(cell => cell.textContent));
    expect(within(originalRows[0]!).getByRole('cell', { name: 'Well matched', exact: true })).toBeInTheDocument();
    const translation = await import('react-i18next');
    const original = translation.useTranslation();
    const labels: Record<string, string> = {
      'chargeDepartureAlignment.modernization.heuristic': 'Heuristische Hinweise, keine bestätigten Fehler',
      'chargeDepartureAlignment.wellMatched': 'Gut abgestimmt',
      'chargeDepartureAlignment.modernization.flags': 'Zuordnungshinweise',
    };
    const t = ((key: string, ...args: unknown[]) => labels[key]
      ?? (original.t as (...values: unknown[]) => string)(key, ...args)) as typeof original.t;
    const localized = vi.spyOn(translation, 'useTranslation').mockReturnValue({
      ...original, t,
    } as ReturnType<typeof translation.useTranslation>);
    try {
      view.rerender(<ChargeDepartureAlignmentPage />);
      const table = within(figure()).getByRole('table');
      expect(within(table).getByRole('columnheader', { name: 'Zuordnungshinweise', exact: true })).toBeInTheDocument();
      const rows = within(table).getAllByRole('row').slice(1);
      expect(rows.map(row => within(row).getAllByRole('cell').slice(0, 3).map(cell => cell.textContent))).toEqual(originalValues);
      expect(within(rows[0]!).getByRole('cell', { name: 'Gut abgestimmt', exact: true })).toBeInTheDocument();
      for (const row of rows.slice(1)) {
        expect(within(row).getByRole('cell', { name: 'Heuristische Hinweise, keine bestätigten Fehler', exact: true }))
          .toBeInTheDocument();
      }
    } finally {
      localized.mockRestore();
    }
  });
});
