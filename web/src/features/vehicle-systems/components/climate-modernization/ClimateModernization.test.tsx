import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import type { ClimateState } from '@/types/vehicle-systems';

const preferences = vi.hoisted(() => ({ temperature: 'C' as 'C' | 'F' }));
// Even an unexpected transitive query cannot reach a real API.
vi.mock('@/api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, request: vi.fn(() => Promise.reject(new Error('Unexpected test request'))) };
});
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {
      unit_of_length: 'km', unit_of_temp: preferences.temperature,
      unit_of_pressure: 'bar', preferred_range: 'rated',
      decimal_precision: 2, locale: 'en-US', currency_symbol: '$',
      ui_density: 'comfortable', ai_mode: 'off', ai_features: {},
    },
    density: 'comfortable', locale: 'en-US', decimals: 2,
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));
vi.mock('@/hooks/useSelectedVehicle', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useSelectedVehicle')>();
  return { ...actual, useSelectedVehicle: () => ({ vehicleId: 42 }) };
});
vi.mock('@/api/hooks/useVehicleSystems', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/hooks/useVehicleSystems')>();
  return { ...actual, useClimate: vi.fn(), useClimateHistory: vi.fn() };
});
vi.mock('@/api/hooks/useVehicles', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/hooks/useVehicles')>();
  return { ...actual, useChargingTelemetryLatest: vi.fn() };
});
// Preserve all needed motion exports rather than installing an incomplete mock.
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return { ...actual, FadeIn: ({ children, className }: {
    children: ReactNode; className?: string;
  }) => <div className={className}>{children}</div> };
});
vi.mock('@/components/ai/AIPreheatPrecoolRecommender', () => ({
  AIPreheatPrecoolRecommender: (props: {
    vehicleId?: number; currentCabinTempC: number | null;
    outsideTempC: number | null; targetCabinTempC: number; departBy: string;
  }) => <div data-testid="climate-ai-props" data-vehicle={props.vehicleId}
    data-cabin={props.currentCabinTempC} data-outside={props.outsideTempC}
    data-target={props.targetCabinTempC} data-depart={props.departBy} />,
}));
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  const container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const chart = ({ children, data }: { children?: ReactNode; data?: unknown }) =>
    <div data-testid="climate-series-data" data-points={JSON.stringify(data)}>{children}</div>;
  const series = ({ dataKey, hide }: { dataKey?: string; hide?: boolean }) =>
    <span data-series={dataKey} data-hidden={String(hide)} />;
  const decoration = () => <span />;
  return {
    ...actual, ...chartTestDoubles,
    ResponsiveContainer: container, LineChart: chart, AreaChart: chart,
    Line: series, Area: series, XAxis: decoration, YAxis: decoration,
    CartesianGrid: decoration, Tooltip: decoration,
  };
});

import { useClimate, useClimateHistory } from '@/api/hooks/useVehicleSystems';
import { useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import ClimateControlPage from '../../pages/ClimateControlPage';
import { ClimateRenderGrid, ClimateRenderGroup } from './index';

const snapshot: ClimateState = {
  id: 1, timestamp: '2026-10-04T12:00:00Z',
  insideTemp: 22, outsideTemp: 15, driverTempSetting: 21, passengerTempSetting: 20,
  hvacPower: false, isAcOn: true, hvacAutoMode: 'On', fanSpeed: 2.5,
  hvacFanStatus: 3, climateKeeperMode: 'Dog Mode', defrostMode: 'Normal',
  defrostForPreconditioning: true, rearDefrostEnabled: false,
  wiperHeatEnabled: true, rearDisplayHvacEnabled: true,
  batteryHeater: false, overheatProtection: 'On', cabinOverheatProtectionTempLimit: '40',
  hvacSteeringWheelHeatLevel: 2, hvacSteeringWheelHeatAuto: true,
  seatHeaterLeft: 3, seatHeaterRight: 2, seatHeaterRearLeft: 1,
  seatHeaterRearCenter: 0, seatHeaterRearRight: 1,
  autoSeatClimateLeft: true, autoSeatClimateRight: false,
  climateSeatCoolingFrontLeft: 2, climateSeatCoolingFrontRight: 0, seatVentEnabled: true,
};
const history: ClimateState[] = [
  { ...snapshot, id: 3, timestamp: '2026-10-04T12:00:00Z', fanSpeed: 6, isAcOn: false },
  { ...snapshot, id: 2, timestamp: '2026-10-04T11:00:00Z', fanSpeed: 4, isAcOn: true },
];
function query<T>(data: T | undefined, overrides: Record<string, unknown> = {}) {
  return {
    data, error: null, isError: false, isLoading: false, isPending: false,
    isSuccess: true, isFetching: false, isStale: false, fetchStatus: 'idle',
    dataUpdatedAt: Date.now(), refetch: vi.fn(), ...overrides,
  };
}
function latest(data: ClimateState | undefined, overrides: Record<string, unknown> = {}) {
  vi.mocked(useClimate).mockReturnValue(
    query(data, overrides) as unknown as ReturnType<typeof useClimate>,
  );
}
function historical(data: ClimateState[] | undefined, overrides: Record<string, unknown> = {}) {
  vi.mocked(useClimateHistory).mockReturnValue(
    query(data, overrides) as unknown as ReturnType<typeof useClimateHistory>,
  );
}
function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/climate']}><ClimateControlPage /></MemoryRouter>
  </QueryClientProvider>);
}
function metric(label: string): HTMLElement {
  const match = screen.getByText(label, { selector: '[data-operational-metric] > div:first-child > :first-child' })
    .closest<HTMLElement>('[data-operational-metric]');
  if (!match) throw new Error(`Missing canonical stat: ${label}`);
  return match;
}
function group(container: HTMLElement, id: string): HTMLElement {
  const match = container.querySelector<HTMLElement>(`[data-climate-group="${id}"]`);
  if (!match) throw new Error(`Missing climate group: ${id}`);
  return match;
}
const outline = [
  'climate-ai', 'climate-status', 'climate-temperature', 'climate-comfort',
  'climate-systems', 'climate-protection', 'climate-seats', 'climate-efficiency',
  'climate-temperature-history', 'climate-hvac-history', 'climate-history-table',
];
beforeEach(() => {
  vi.clearAllMocks();
  preferences.temperature = 'C';
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  latest(snapshot);
  historical(history);
  vi.mocked(useChargingTelemetryLatest).mockReturnValue(query({
    not_enough_power_to_heat: true,
  }) as unknown as ReturnType<typeof useChargingTelemetryLatest>);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Climate live modernization — no real API or vehicle commands', () => {
  it('retains every group, 21 system/efficiency stats plus score/delta, both chart IDs and all series', () => {
    const { container } = mountPage();
    expect(Array.from(container.querySelectorAll('[data-climate-group]'))
      .map(node => node.getAttribute('data-climate-group'))).toEqual(outline);
    expect(container.querySelectorAll('[data-card-grid]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(23);
    expect(screen.getAllByTestId('embedded-chart').map(node =>
      node.getAttribute('data-chart-key'))).toEqual(['climate-temp-history', 'climate-hvac-history']);
    expect(Array.from(container.querySelectorAll('[data-series]')).map(node =>
      node.getAttribute('data-series'))).toEqual([
      'insideTemp', 'outsideTemp', 'driverTempSetting', 'acActive', 'fanSpeed',
    ]);
    expect(within(group(container, 'climate-seats')).getAllByText(/Front left|Front right|Rear left|Rear center|Rear right/))
      .toHaveLength(7);
    expect(within(group(container, 'climate-seats')).getByText('Ventilation: On')).toBeInTheDocument();
  });

  it('retains SI AI props, bool power state, fractional fan and original efficiency calculations', () => {
    const { container } = mountPage();
    expect(screen.getByTestId('climate-ai-props')).toHaveAttribute('data-cabin', '22');
    expect(screen.getByTestId('climate-ai-props')).toHaveAttribute('data-outside', '15');
    expect(screen.getByTestId('climate-ai-props')).toHaveAttribute('data-target', '21');
    expect(screen.getByTestId('climate-ai-props')).toHaveAttribute('data-vehicle', '42');
    expect(within(metric('HVAC power')).getByText('State: Off')).toBeInTheDocument();
    expect(within(metric('HVAC power')).getByText('On')).toBeInTheDocument();
    expect(within(metric('Fan speed')).getByText('2.5')).toBeInTheDocument();
    expect(within(metric('Avg fan speed')).getByText('5.00')).toBeInTheDocument();
    expect(within(metric('Peak fan speed')).getByText('6.00')).toBeInTheDocument();
    expect(within(metric('AC on time')).getByText('50.00%')).toBeInTheDocument();
    expect(within(group(container, 'climate-comfort')).getByText('90.00')).toBeInTheDocument();
  });

  it('updates absolute temperatures and differences through C/F preferences without mutating SI inputs', () => {
    const view = mountPage();
    expect(within(metric('Passenger setting')).getByText('20.00°C')).toBeInTheDocument();
    expect(screen.getByText('+1.00°C')).toBeInTheDocument();
    preferences.temperature = 'F';
    view.rerender(<QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><ClimateControlPage /></MemoryRouter>
    </QueryClientProvider>);
    expect(within(metric('Passenger setting')).getByText('68.00°F')).toBeInTheDocument();
    expect(screen.getByText('+1.80°F')).toBeInTheDocument();
    const points = JSON.parse(screen.getAllByTestId('climate-series-data')[0]
      .getAttribute('data-points') ?? '[]') as ClimateState[];
    expect(points[0].insideTemp).toBeCloseTo(71.6);
    expect(points[0].outsideTemp).toBe(59);
    expect(points[0].driverTempSetting).toBeCloseTo(69.8);
    expect(snapshot.insideTemp).toBe(22);
    expect(screen.getByTestId('climate-ai-props')).toHaveAttribute('data-cabin', '22');
    expect(screen.getByText('Near target')).toBeInTheDocument();
  });

  it('keeps locale/precision reactivity and unrounded threshold semantics', () => {
    latest({ ...snapshot, insideTemp: 22.234 });
    mountPage();
    expect(screen.getByText('+1.23°C')).toBeInTheDocument();
    act(() => setGlobalLocale('de-DE'));
    expect(screen.getByText('+1,23°C')).toBeInTheDocument();
    act(() => setGlobalPrecision(0));
    expect(screen.getByText('+1°C')).toBeInTheDocument();
    expect(screen.getByText('Above target')).toBeInTheDocument();
    expect(screen.queryByText('Near target')).not.toBeInTheDocument();
  });

  it('keeps loading and fatal failures source-local, including live score when history fails', () => {
    historical(undefined, { isLoading: true, isSuccess: false });
    const view = mountPage();
    expect(within(metric('Fan speed')).getByText('2.5')).toBeInTheDocument();
    expect(within(group(view.container, 'climate-efficiency')).getByText('90.00%')).toBeInTheDocument();
    expect(screen.queryByTestId('embedded-chart')).not.toBeInTheDocument();
    cleanup();
    historical(undefined, { error: new Error('history unavailable'), isError: true });
    const failed = mountPage();
    expect(within(group(failed.container, 'climate-efficiency')).getByText('90.00%')).toBeInTheDocument();
    expect(within(group(failed.container, 'climate-temperature-history')).getByText('Retry')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Seat heaters' })).toBeInTheDocument();
  });

  it('keeps history available when latest fails and retries only the failed source', () => {
    const retry = vi.fn();
    latest(undefined, { error: new Error('latest unavailable'), isError: true, refetch: retry });
    const { container } = mountPage();
    expect(screen.getAllByTestId('embedded-chart')).toHaveLength(2);
    expect(within(metric('Avg fan speed')).getByText('5.00')).toBeInTheDocument();
    fireEvent.click(within(group(container, 'climate-systems')).getByText('Retry'));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('[data-climate-group]')).toHaveLength(11);
  });

  it('keeps history and efficiency available while the latest reading initially loads', () => {
    latest(undefined, { isLoading: true, isSuccess: false });
    const { container } = mountPage();
    expect(screen.getAllByTestId('embedded-chart')).toHaveLength(2);
    expect(within(metric('Avg fan speed')).getByText('5.00')).toBeInTheDocument();
    expect(within(group(container, 'climate-systems')).queryByText('HVAC power')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Seat heaters' })).toBeInTheDocument();
  });

  it('isolates charging loading/failure and preserves the original true-only power warning', () => {
    vi.mocked(useChargingTelemetryLatest).mockReturnValue(query(undefined, {
      isLoading: true, isSuccess: false,
    }) as unknown as ReturnType<typeof useChargingTelemetryLatest>);
    mountPage();
    expect(within(metric('Fan speed')).getByText('2.5')).toBeInTheDocument();
    expect(screen.getAllByTestId('embedded-chart')).toHaveLength(2);
    cleanup();
    const chargingRetry = vi.fn();
    vi.mocked(useChargingTelemetryLatest).mockReturnValue(query(undefined, {
      error: new Error('charging source failed'), isError: true, refetch: chargingRetry,
    }) as unknown as ReturnType<typeof useChargingTelemetryLatest>);
    const failed = mountPage();
    fireEvent.click(within(group(failed.container, 'climate-status')).getByText('Retry'));
    expect(chargingRetry).toHaveBeenCalledTimes(1);
    expect(within(metric('HVAC power')).getByText('State: Off')).toBeInTheDocument();
    cleanup();
    vi.mocked(useChargingTelemetryLatest).mockReturnValue(query({
      not_enough_power_to_heat: false,
    }) as unknown as ReturnType<typeof useChargingTelemetryLatest>);
    const clear = mountPage();
    expect(within(group(clear.container, 'climate-status')).queryByText('Insufficient power to heat'))
      .not.toBeInTheDocument();
  });

  it('retains populated readings and charts after refresh errors', () => {
    latest(snapshot, { error: new Error('refresh failed'), isError: true });
    historical(history, { error: new Error('history refresh failed'), isError: true });
    mountPage();
    expect(within(metric('Passenger setting')).getByText('20.00°C')).toBeInTheDocument();
    expect(screen.getAllByTestId('embedded-chart')).toHaveLength(2);
    expect(within(metric('AC on time')).getByText('50.00%')).toBeInTheDocument();
    expect(screen.getAllByText(/Showing retained measurements/).length).toBeGreaterThan(0);
  });

  it('retains a paused charging warning independently and recovers it without erasing failed-refresh climate/history', () => {
    const latestRetry = vi.fn();
    const historyRetry = vi.fn();
    const chargingRetry = vi.fn();
    latest(snapshot, { isError: true, error: new Error('Live climate refresh failed'), refetch: latestRetry });
    historical(history, { isError: true, error: new Error('Climate history refresh failed'), refetch: historyRetry });
    vi.mocked(useChargingTelemetryLatest).mockReturnValue(query({
      not_enough_power_to_heat: true,
    }, { fetchStatus: 'paused', refetch: chargingRetry }) as unknown as ReturnType<typeof useChargingTelemetryLatest>);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = () => <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/climate-control']}><ClimateControlPage /></MemoryRouter>
    </QueryClientProvider>;
    const view = render(ui());
    const status = within(group(view.container, 'climate-status'));
    expect(status.getByText('Insufficient power to heat')).toBeInTheDocument();
    const chargingNotice = status.getByText(/Showing retained measurements.*Insufficient power to heat/);
    const boundary = chargingNotice.parentElement;
    if (!boundary) throw new Error('Missing charging source recovery boundary');
    fireEvent.click(within(boundary).getByRole('button', { name: 'Retry' }));
    expect(chargingRetry).toHaveBeenCalledOnce();
    expect(latestRetry).not.toHaveBeenCalled();
    expect(historyRetry).not.toHaveBeenCalled();
    expect(within(metric('Passenger setting')).getByText('20.00°C')).toBeInTheDocument();
    expect(screen.getAllByTestId('embedded-chart')).toHaveLength(2);

    vi.mocked(useChargingTelemetryLatest).mockReturnValue(query({
      not_enough_power_to_heat: false,
    }, { refetch: chargingRetry }) as unknown as ReturnType<typeof useChargingTelemetryLatest>);
    view.rerender(ui());
    expect(status.queryByText('Insufficient power to heat')).not.toBeInTheDocument();
    expect(status.queryByText(/Showing retained measurements.*Insufficient power to heat/)).not.toBeInTheDocument();
    expect(within(group(view.container, 'climate-systems')).getByText(/Live climate refresh failed/)).toBeInTheDocument();
    expect(within(group(view.container, 'climate-temperature-history')).getByText(/Climate history refresh failed/))
      .toBeInTheDocument();
    expect(within(metric('Fan speed')).getByText('2.5')).toBeInTheDocument();
    expect(screen.getAllByTestId('embedded-chart')).toHaveLength(2);
  });

  it('keeps explicit live zero/false settings distinct from nullable readings through pause and recovery', () => {
    const zero: ClimateState = {
      ...snapshot, insideTemp: 0, driverTempSetting: 0, passengerTempSetting: 0,
      hvacPower: false, isAcOn: false, fanSpeed: 0, batteryHeater: false,
    };
    latest(zero, { fetchStatus: 'paused' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = () => <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/climate-control']}><ClimateControlPage /></MemoryRouter>
    </QueryClientProvider>;
    const view = render(ui());
    expect(within(metric('Passenger setting')).getByText('0.00°C')).toBeInTheDocument();
    expect(within(metric('Fan speed')).getByText('0')).toBeInTheDocument();
    expect(within(metric('HVAC power')).getByText('State: Off')).toBeInTheDocument();
    expect(within(group(view.container, 'climate-comfort')).getByText('100.00')).toBeInTheDocument();
    expect(within(group(view.container, 'climate-systems')).getByText(/Showing retained measurements/, {
      selector: '[role="status"][aria-live="polite"]',
    }))
      .toHaveTextContent('The device is offline, so this section is showing the last values it received.');

    latest({
      ...zero, insideTemp: null, driverTempSetting: null,
      passengerTempSetting: null, fanSpeed: null,
      hvacPower: null, isAcOn: null, batteryHeater: null,
    });
    view.rerender(ui());
    expect(within(metric('Passenger setting')).getByText('—')).toBeInTheDocument();
    expect(within(metric('Fan speed')).getByText('—')).toBeInTheDocument();
    expect(within(metric('HVAC power')).getByText('—')).toBeInTheDocument();
    expect(within(metric('Battery heater')).getByText('—')).toBeInTheDocument();
    expect(within(group(view.container, 'climate-systems')).queryByText(/Showing retained measurements/))
      .not.toBeInTheDocument();
    expect(within(group(view.container, 'climate-comfort')).queryByText('100.00')).not.toBeInTheDocument();
    expect(within(metric('Avg fan speed')).getByText('5.00')).toBeInTheDocument();
    expect(screen.getAllByTestId('embedded-chart')).toHaveLength(2);
    expect(zero.insideTemp).toBe(0);
    expect(zero.fanSpeed).toBe(0);
    expect(zero.hvacPower).toBe(false);
  });

  it('never presents unknown values as measured zero, off, poor or comfortable', () => {
    latest({});
    historical([]);
    const { container } = mountPage();
    expect(within(metric('HVAC power')).getByText('—')).toBeInTheDocument();
    expect(within(metric('Fan speed')).getByText('—')).toBeInTheDocument();
    expect(within(metric('Battery heater')).getByText('—')).toBeInTheDocument();
    const comfort = within(group(container, 'climate-comfort'));
    expect(comfort.queryByText('Comfortable')).not.toBeInTheDocument();
    expect(comfort.queryByText('Poor')).not.toBeInTheDocument();
    expect(within(group(container, 'climate-seats')).queryByText('Off (0/3)')).not.toBeInTheDocument();
    expect(screen.getByText('No temperature history has been recorded.')).toBeInTheDocument();
    expect(screen.getByText('No HVAC operating history has been recorded.')).toBeInTheDocument();
    expect(screen.getByText('No climate history has been recorded.')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-climate-group]')).toHaveLength(11);
  });

  it('forwards Refresh to the existing read refetch and keeps the same scoped hooks', () => {
    const refetch = vi.fn();
    latest(snapshot, { refetch });
    mountPage();
    fireEvent.click(screen.getByText('Refresh'));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(useClimate).toHaveBeenCalledWith('42');
    expect(useClimateHistory).toHaveBeenCalledWith('42');
    expect(useChargingTelemetryLatest).toHaveBeenCalledWith(42);
  });
});

describe('one host observer, provider placement and preservation source contracts', () => {
  it('observes once and consumes packed spans below the provider at each container band', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    let notify: ResizeObserverCallback | undefined;
    const observer = { observe, disconnect, unobserve: vi.fn() };
    const create = vi.fn(function (callback: ResizeObserverCallback) {
      notify = callback;
      return observer;
    });
    vi.stubGlobal('ResizeObserver', create);
    const { container, unmount } = render(<ClimateRenderGrid label="Climate overview">
      <ClimateRenderGroup id="first" size="half">Temperature</ClimateRenderGroup>
      <ClimateRenderGroup id="second" size="half">Comfort</ClimateRenderGroup>
    </ClimateRenderGrid>);
    expect(create).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(1);
    for (const [width, span] of [[375, 1], [768, 6], [1280, 6], [1920, 6]]) {
      act(() => notify?.([{ contentRect: { width } } as ResizeObserverEntry],
        observer as ResizeObserver));
      expect(group(container, 'first')).toHaveAttribute('data-climate-span', String(span));
      expect(group(container, 'second')).toHaveAttribute('data-climate-span', String(span));
    }
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('retains query scope, legend/cursor IDs, table filters/export identity and chart accessibility', () => {
    // Works from repo root or web cwd on Windows without URL pathname slicing.
    const webRoot = existsSync(resolve(process.cwd(), 'src/features'))
      ? process.cwd() : resolve(process.cwd(), 'web');
    const source = readFileSync(resolve(webRoot,
      'src/features/vehicle-systems/pages/ClimateControlPage.tsx'), 'utf8');
    expect(source.match(/<ClimateRenderGrid\b/g)).toHaveLength(1);
    expect(source).toContain('<PageLayout');
    expect(source.match(/<LayoutCard\b/g)).toHaveLength(10);
    expect(source).not.toMatch(/empty=\{|max-w-\[1600px\]|ResizeObserver|useContainerWidth/);
    expect(source).toContain('tableId="vehicle-systems:climate-history"');
    expect(source).toContain('enableValueFilters');
    expect(source).toContain('filterData={history ?? []}');
    expect(source).toContain('onSort={onSort}');
    expect(source).toContain("mobileColumns={['timestamp', 'insideTemp', 'outsideTemp']}");
    for (const key of ['insideTemp', 'outsideTemp', 'driverTempSetting', 'acActive', 'fanSpeed']) {
      expect(source).toContain(`hiddenSeries?.isHidden('${key}')`);
    }
    expect(source.match(/<EmbeddedChart\b/g)).toHaveLength(2);
    expect(source.match(/ariaLabel=\{t\('climate\.history\./g)).toHaveLength(2);
    expect(source).toContain('climateAcGrad');
    expect(source).toContain('sortFn(history, climateAccessor)');
    expect(source).toContain('Math.max(0, 100 - delta * 10)');
    expect(source).toContain('(acOnCount / chronoHistory.length) * 100');
    expect(source).toContain('targetCabinTempC={latest?.driverTempSetting ?? 21}');
    expect(source).not.toMatch(/useMutation|\bfetch\(|\/api\/v1|[?&]vehicleId=|from ['"](?:recharts|framer-motion|react-leaflet)['"]/);
  });
});
