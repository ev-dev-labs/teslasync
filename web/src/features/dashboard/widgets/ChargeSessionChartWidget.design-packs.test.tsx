import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { request } from '@/api/client';
import { fmtNumber } from '@/lib/numberFormat';
import { dashboardTokens } from '../lib/dashboardTokens';
import ChargeSessionChartWidget from './ChargeSessionChartWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
import type { WidgetSize } from './types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, options?: Record<string, unknown>) =>
      (typeof fallback === 'string' ? fallback : key).replace(
        /{{(\w+)}}/g,
        (match, name: string) => options?.[name] == null ? match : String(options[name]),
      ),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  request: vi.fn(),
}));

const plot = vi.hoisted(() => ({
  chart: {} as Record<string, unknown>,
  bar: {} as Record<string, unknown>,
  xAxis: {} as Record<string, unknown>,
  yAxis: {} as Record<string, unknown>,
  tooltip: {} as Record<string, unknown>,
}));

// Keep the real chart frame, accessible table, pack boundary and presentation.
// Only Recharts' measurement/context-dependent primitives are substituted.
vi.mock('@/components/charts', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/charts')>(),
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <>{children}</>,
  BarChart: (props: Record<string, unknown>) => {
    plot.chart = props;
    return <svg>{props.children as ReactNode}</svg>;
  },
  Bar: (props: Record<string, unknown>) => {
    plot.bar = props;
    return <g>{props.children as ReactNode}</g>;
  },
  Cell: ({ fill }: { fill?: string }) => <rect data-testid="session-cell" fill={fill} />,
  XAxis: (props: Record<string, unknown>) => { plot.xAxis = props; return null; },
  YAxis: (props: Record<string, unknown>) => { plot.yAxis = props; return null; },
  Tooltip: (props: Record<string, unknown>) => { plot.tooltip = props; return null; },
  chartGrid: null,
}));

interface SessionFixture {
  id: number;
  vehicle_id: number;
  started_at: string;
  total_energy_added_wh: number | null;
  charger_type: string | null;
}

interface PlotDatum {
  label: string;
  energy: number | null;
  type: string;
}

const sessions: SessionFixture[] = [
  { id: 4, vehicle_id: 7, started_at: '2026-11-06T12:00:00Z', total_energy_added_wh: 42_000, charger_type: 'AC' },
  { id: 3, vehicle_id: 7, started_at: '2026-11-05T12:00:00Z', total_energy_added_wh: 0, charger_type: 'DC' },
  { id: 2, vehicle_id: 7, started_at: '2026-11-04T12:00:00Z', total_energy_added_wh: -1_500, charger_type: 'SUPERCHARGER' },
  { id: 1, vehicle_id: 7, started_at: '2026-11-03T12:00:00Z', total_energy_added_wh: null, charger_type: null },
];
const packs = Object.entries(PACK_APPEARANCES);
const standard: WidgetSize = { cols: 3, rows: 4 };
const compact: WidgetSize = { cols: 1, rows: 1 };
const mockRequest = vi.mocked(request);
const clients: QueryClient[] = [];
const chargingCalls = () => mockRequest.mock.calls.filter(([path]) => String(path).startsWith('/charging'));

function routeSessions(rows: SessionFixture[]) {
  mockRequest.mockImplementation((path: string) =>
    Promise.resolve(path.startsWith('/charging') ? rows : []),
  );
}

function renderWidget(packId: unknown = 'classic', size = standard) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  const tree = (requestedPackId: unknown) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={requestedPackId}>
          <ChargeSessionChartWidget vehicleId={7} size={size} config={{ timeRange: '7d' }} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(packId));
  return { ...view, selectPack: (next: unknown) => view.rerender(tree(next)) };
}

async function waitForAppearance(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(container.querySelector(
    `[data-widget-family="bars"][data-widget-appearance="${appearance}"]`,
  )).toBeInTheDocument(), { timeout: 5000 });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  plot.chart = {};
  plot.bar = {};
  plot.xAxis = {};
  plot.yAxis = {};
  plot.tooltip = {};
  routeSessions(sessions);
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  vi.restoreAllMocks();
});

describe('charge-session-chart production packs', () => {
  it.each(packs)('%s mounts the real %s bars presentation without changing the historical plot', async (packId, appearance) => {
    const view = renderWidget(packId);
    await waitForAppearance(view.container, appearance);

    expect(view.container.querySelector('[data-role="widget-header-title"]')).toHaveAccessibleName('Charge Session Chart');
    expect(screen.getByText('Latest session')).toBeInTheDocument();
    expect(screen.getByText('Latest session').closest('.widget-big-number')).toHaveTextContent(fmtNumber(42));
    expect(screen.getByText('Energy by charger type')).toBeInTheDocument();
    expect(screen.getByText('Energy per session · last 20')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Bar chart of energy added per charge session' })).toBeInTheDocument();
    expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'partial');
    expect(plot.chart.data).toEqual([
      expect.objectContaining({ energy: null, type: 'unknown' }),
      expect.objectContaining({ energy: -1.5, type: 'supercharger' }),
      expect.objectContaining({ energy: 0, type: 'dc' }),
      expect.objectContaining({ energy: 42, type: 'ac' }),
    ]);
    expect(plot.xAxis.dataKey).toBe('label');
    expect(plot.yAxis.domain).toBeUndefined();
    expect(plot.yAxis.width).toEqual(expect.any(Number));
    expect(plot.bar.dataKey).toBe('energy');
    expect(screen.getAllByTestId('session-cell').map(cell => cell.getAttribute('fill'))).toEqual([
      dashboardTokens.chart.series[4], dashboardTokens.chart.series[3],
      dashboardTokens.chart.series[2], dashboardTokens.chart.series[0],
    ]);
    const table = screen.getByRole('table', { name: 'Charge Session Chart — data table' });
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    expect(within(table).getByRole('columnheader', { name: 'Added (kWh)' })).toBeInTheDocument();
    expect(within(table).getByText('ac')).toBeInTheDocument();
    expect(screen.getByText('Supercharger')).toBeInTheDocument();
    expect(screen.getAllByText('Unknown')).toHaveLength(2);
    const tooltip = plot.tooltip.formatter as (value: number, name: string, props: { payload: PlotDatum }) => string[];
    const data = plot.chart.data as PlotDatum[];
    expect(tooltip(42, 'energy', { payload: data[3] })).toEqual([`${fmtNumber(42)} kWh`, 'AC']);
    const tooltipLabel = plot.tooltip.labelFormatter as (label: string) => string;
    expect(tooltipLabel(data[3].label)).toBe(data[3].label);
    expect(data.every(point => point.label !== '—')).toBe(true);
    expect(chargingCalls()).toHaveLength(1);
    const params = new URL(String(chargingCalls()[0][0]), 'https://test.invalid').searchParams;
    expect(params.get('vehicle_id')).toBe('7');
    expect(params.get('limit')).toBe('20');
    expect(params.get('start')).toBeTruthy();
    expect(params.get('end')).toBeTruthy();
    if (packId === 'v7') {
      expect(view.container.querySelector('[data-instrument-appearance="pixel"] .lucide-zap')).toBeInTheDocument();
      expect(screen.queryByRole('meter')).not.toBeInTheDocument();
      expect(plot.bar.radius).toEqual([2, 2, 0, 0]);
    }
  });

  it.each(packs)('%s keeps the compact summary without adding a chart or legend', async (packId, appearance) => {
    const view = renderWidget(packId, compact);
    await waitForAppearance(view.container, appearance);
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText(fmtNumber(40.5))).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('Home / AC')).not.toBeInTheDocument();
    expect(screen.queryByText('Latest session')).not.toBeInTheDocument();
    expect(plot.chart).toEqual({});
    expect(chargingCalls()).toHaveLength(1);
  });

  it.each(packs)('%s keeps an honest empty source within the %s presentation', async (packId, appearance) => {
    routeSessions([]);
    const view = renderWidget(packId);
    await waitForAppearance(view.container, appearance);
    expect(screen.getByText('No charge sessions yet')).toBeInTheDocument();
    expect(screen.getByText('Energy by charger type')).toBeInTheDocument();
    expect(screen.queryByText(fmtNumber(0))).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'unavailable');
    expect(view.container.querySelector('[data-role="widget-header-title"]')).toHaveAccessibleName('Charge Session Chart');
  });

  it.each(packs)('%s does not present a partial charger-type subtotal as a complete energy measurement', async (packId, appearance) => {
    routeSessions([{ ...sessions[0], id: 5, total_energy_added_wh: null }, sessions[0]]);
    const view = renderWidget(packId);
    await waitForAppearance(view.container, appearance);
    const details = screen.getByText('Energy by charger type').parentElement!;
    const acSummary = within(details).getByText('Home / AC').parentElement;
    expect(acSummary).toHaveTextContent('—');
    expect(acSummary).not.toHaveTextContent(fmtNumber(42));
    expect(screen.getByText('Latest session').closest('.widget-big-number')).toHaveTextContent('—');
    expect(plot.chart.data).toEqual([
      expect.objectContaining({ energy: 42, type: 'ac' }),
      expect.objectContaining({ energy: null, type: 'ac' }),
    ]);
  });

  it.each(packs)('%s does not replace an unknown latest session with an older known reading', async (packId, appearance) => {
    routeSessions([{ ...sessions[0], total_energy_added_wh: Number.NaN, charger_type: null }, sessions[2]]);
    const view = renderWidget(packId);
    await waitForAppearance(view.container, appearance);
    const latest = screen.getByText('Latest session').closest('.widget-big-number');
    expect(latest).toHaveTextContent('—');
    expect(latest).not.toHaveTextContent(fmtNumber(-1.5));
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
    expect(screen.queryByText(fmtNumber(0))).not.toBeInTheDocument();
    expect(plot.chart.data).toEqual([
      expect.objectContaining({ energy: -1.5 }),
      expect.objectContaining({ energy: null, type: 'unknown' }),
    ]);
  });

  it('switches all packs on one data controller and recovers the original Classic body', async () => {
    const view = renderWidget();
    await screen.findByRole('img', { name: 'Bar chart of energy added per charge session' });
    expect(screen.queryByText('Latest session')).not.toBeInTheDocument();
    expect(plot.bar.radius).toEqual([4, 4, 0, 0]);
    expect(plot.bar.maxBarSize).toBe(32);
    for (const [packId, appearance] of packs) {
      view.selectPack(packId);
      await waitForAppearance(view.container, appearance);
      expect((plot.chart.data as PlotDatum[]).map(point => point.energy)).toEqual([null, -1.5, 0, 42]);
    }
    view.selectPack('retired-pack');
    await waitFor(() => expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', 'classic'));
    expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
    expect(screen.queryByText('Latest session')).not.toBeInTheDocument();
    expect(screen.queryByText('Energy by charger type')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Bar chart of energy added per charge session' })).toBeInTheDocument();
    expect(plot.bar.radius).toEqual([4, 4, 0, 0]);
    expect(chargingCalls()).toHaveLength(1);
  });

  it.each(packs)('%s retains the active pack, source gaps, plot and refresh control after a failed refresh', async (packId, appearance) => {
    const view = renderWidget(packId);
    await waitForAppearance(view.container, appearance);
    const originalData = plot.chart.data;
    mockRequest.mockImplementation((path: string) => path.startsWith('/charging')
      ? Promise.reject(new Error('synthetic refresh failure')) : Promise.resolve([]));
    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
    expect(await screen.findByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'stale');
    expect(view.container.querySelector(`[data-widget-appearance="${appearance}"]`)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Bar chart of energy added per charge session' })).toBeInTheDocument();
    expect(plot.chart.data).toEqual(originalData);
    expect(screen.getByText('Latest session')).toBeInTheDocument();
    expect(chargingCalls()).toHaveLength(2);
  });
});
