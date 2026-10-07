import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Drive, VehicleState } from '@/api/types';
import { convertDistanceFromSI } from '@/lib/unitConversion';

// Synthetic deterministic fixtures are test-only, never a production source.
const fixtures = vi.hoisted(() => ({ distance: 'km' as 'km' | 'mi', hideDistance: false }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: fixtures.distance } }),
}));
vi.mock('@/components/data-display', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/data-display')>(),
  AnimatedNumber: ({ value, suffix }: { value: number; suffix?: string }) => <span>{value}{suffix}</span>,
}));
interface ChartFixtureProps {
  children?: ReactNode | ((ctx: { hiddenSeries: { isHidden: (key: string) => boolean } }) => ReactNode);
  title: string;
  ariaLabel: string;
  data?: ReadonlyArray<Record<string, unknown>>;
  dataColumns?: ReadonlyArray<{ key: string; label: string }>;
  chartKey?: string;
  height?: number;
}
function EmbeddedChartFixture({ children, title, ariaLabel, data, dataColumns, chartKey, height }: ChartFixtureProps) {
  return (
    <div data-testid="embedded-fixture" aria-label={ariaLabel} data-title={title}
      data-series={JSON.stringify(data)} data-columns={JSON.stringify(dataColumns)}
      data-chart-key={chartKey} data-height={height}>
      {typeof children === 'function' ? children({ hiddenSeries: { isHidden: key => key === 'distance' && fixtures.hideDistance } }) : children}
    </div>
  );
}
vi.mock('@/components/charts/EmbeddedChart', () => ({ EmbeddedChart: EmbeddedChartFixture }));
vi.mock('@/components/charts', () => ({
  CHART_COLORS: ['#06b6d4', '#a855f7'], AREA_DEFAULTS: {}, areaGradient: () => null,
  LinearGauge: ({ value, label }: { value: number; label: string }) => <div data-testid="battery-gauge" data-value={value} aria-label={label} />,
  ChartTooltip: () => null, CartesianGrid: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, Bar: () => null,
  ChartLegend: () => <div data-testid="preserved-chart-legend" />,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BarChart: ({ data, children }: { data: unknown; children: ReactNode }) => <div data-testid="battery-bars" data-series={JSON.stringify(data)}>{children}</div>,
  AreaChart: ({ data, children }: { data: unknown; children: ReactNode }) => <div data-testid="drive-areas" data-series={JSON.stringify(data)}>{children}</div>,
  Area: ({ dataKey, hide }: { dataKey: string; hide: boolean }) => <div data-testid={`series-${dataKey}`} data-hidden={String(hide)} />,
  EmbeddedChart: EmbeddedChartFixture,
}));

import { VehicleDetailCharts } from './VehicleDetailCharts';

const syntheticState: VehicleState = {
  vehicle_id: 1, state: 'online', latitude: 0, longitude: 0, speed: 0, power: 0,
  battery_level: 42, rated_range: 400_000, ideal_range: 420_000, odometer: 1_000_000,
  inside_temp: 21, outside_temp: 15, is_climate_on: false, is_charging: false,
  charger_power: 0, charge_rate: 0, time_to_full_charge: 0, is_locked: true,
  sentry_mode: false, software_version: 'synthetic-test',
};
function syntheticDrive(id: number, distance_m: number, duration_s: number): Drive {
  return {
    id, vehicle_id: 1, start_ts: `2026-10-0${id}T10:00:00Z`, end_ts: `2026-10-0${id}T11:00:00Z`,
    distance_m, duration_s, start_address: null, end_address: null,
    start_lat: null, start_lon: null, end_lat: null, end_lon: null,
    start_soc_pct: 80, end_soc_pct: 70, energy_used_wh: null, regen_energy_wh: null,
    avg_speed_mps: null, max_speed_mps: null, avg_power_w: null,
    outside_temp_avg_c: null, inside_temp_avg_c: null, score: null, ended_status: null,
    created_at: '2026-10-04T12:00:00Z', updated_at: '2026-10-04T12:00:00Z',
  };
}
const syntheticDrives = [syntheticDrive(2, 80_000, 3_600), syntheticDrive(1, 40_000, 1_800)];
function DriveLocationProbe() {
  const location = useLocation();
  return <output data-testid="drive-location">{location.pathname}</output>;
}
beforeEach(() => { fixtures.distance = 'km'; fixtures.hideDistance = false });
afterEach(() => vi.unstubAllGlobals());

describe('production vehicle charts through shared layout', () => {
  it('keeps drive evidence when the independent live-state source fails', () => {
    render(<MemoryRouter><VehicleDetailCharts state={undefined} drives={syntheticDrives}
      stateQuery={{ error: new Error('Fixture state failed'), isError: true }}
      drivesQuery={{ data: syntheticDrives, isSuccess: true }} /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Battery overview' })).toBeInTheDocument();
    expect(screen.queryByTestId('battery-bars')).not.toBeInTheDocument();
    expect(screen.getByTestId('drive-areas')).toBeInTheDocument();
    expect(screen.getByTestId('preserved-chart-legend')).toBeInTheDocument();
    const source = screen.getByLabelText('Recent drive distance and duration area chart');
    expect(source).toHaveAttribute('data-chart-key', 'battery-drive-trend');
    const columns = JSON.parse(source.getAttribute('data-columns') ?? '[]') as Array<{ key: string }>;
    expect(columns.map(column => column.key)).toEqual(['date', 'distance', 'duration']);
  });

  it.each(['km', 'mi'] as const)('preserves both source series, reverse chronology and SI preference conversion for %s', unit => {
    fixtures.distance = unit;
    render(<VehicleDetailCharts state={syntheticState} drives={syntheticDrives}
      stateQuery={{ data: { state: syntheticState }, isSuccess: true }}
      drivesQuery={{ data: syntheticDrives, isSuccess: true }} />);
    const rows = JSON.parse(screen.getByTestId('drive-areas').getAttribute('data-series') ?? '[]') as Array<{ distance: number; duration: number }>;
    expect(rows.map(row => row.distance)).toEqual([
      Math.round(convertDistanceFromSI(40_000, unit)), Math.round(convertDistanceFromSI(80_000, unit)),
    ]);
    expect(rows.map(row => row.duration)).toEqual([30, 60]);
    const battery = JSON.parse(screen.getByTestId('battery-bars').getAttribute('data-series') ?? '[]') as Array<{ value: number }>;
    expect(battery.map(row => row.value)).toEqual([42, 58]);
    expect(screen.getByTestId('battery-gauge')).toHaveAttribute('data-value', '42');
    expect(screen.getByText('42%')).toBeInTheDocument();
    const order = screen.getByTestId('battery-gauge').compareDocumentPosition(screen.getByTestId('battery-bars'));
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('keeps legend persistence and independently applies the original distance visibility toggle', () => {
    fixtures.hideDistance = true;
    render(<VehicleDetailCharts state={syntheticState} drives={syntheticDrives}
      stateQuery={{ data: { state: syntheticState } }} drivesQuery={{ data: syntheticDrives }} />);
    expect(screen.getByTestId('series-distance')).toHaveAttribute('data-hidden', 'true');
    expect(screen.getByTestId('series-duration')).toHaveAttribute('data-hidden', 'false');
    expect(screen.getByLabelText('Recent drive distance and duration area chart')).toHaveAttribute('data-chart-key', 'battery-drive-trend');
  });

  it('keeps both titled chart shells and the original successful empty-drive state', () => {
    render(<MemoryRouter><VehicleDetailCharts state={syntheticState} drives={[]}
      stateQuery={{ data: { state: syntheticState } }} drivesQuery={{ data: [] }} /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Battery overview' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Drive distance trend' })).toBeInTheDocument();
    expect(screen.getByText('No drive data for chart')).toBeInTheDocument();
    expect(screen.getByTestId('battery-bars')).toBeInTheDocument();
  });

  it('offers existing drive-history navigation from the successful empty trend without hiding battery evidence', () => {
    render(<MemoryRouter initialEntries={['/vehicles/1']}>
      <VehicleDetailCharts state={syntheticState} drives={[]}
        stateQuery={{ data: { state: syntheticState } }} drivesQuery={{ data: [] }} />
      <DriveLocationProbe />
    </MemoryRouter>);
    const history = screen.getByRole('link', { name: 'View all' });
    expect(history).toHaveAttribute('href', '/drives');
    expect(screen.getByText('No drive data for chart')).toBeInTheDocument();
    expect(screen.getByTestId('battery-bars')).toBeInTheDocument();
    fireEvent.click(history);
    expect(screen.getByTestId('drive-location')).toHaveTextContent('/drives');
  });

  it('uses the allocated shared-grid boundary for equal paired plot heights', () => {
    const observers = new Map<Element, ResizeObserverCallback>();
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) { observers.set(target, this.callback) }
      disconnect() {}
    });
    render(<VehicleDetailCharts state={syntheticState} drives={syntheticDrives}
      stateQuery={{ data: { state: syntheticState } }} drivesQuery={{ data: syntheticDrives }} />);
    expect(observers.size).toBe(1);
    for (const [width, height] of [[520, 200], [768, 240], [1280, 280]]) {
      act(() => {
        for (const [target, callback] of observers) {
          callback([{ target, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
        }
      });
      expect(screen.getAllByTestId('embedded-fixture').map(node => node.getAttribute('data-height'))).toEqual([String(height), String(height)]);
    }
  });
});
