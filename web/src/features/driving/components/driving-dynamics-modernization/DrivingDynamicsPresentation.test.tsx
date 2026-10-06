import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MotorSnapshot, DriveDynamicsSnapshot } from '@/api/types';
import type { DataStateSource } from '@/api/dataState';
import type { Drive } from '@/types/driving';
import { ChartCard } from '@/components/layout/layout-reference';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import RideOverview from './RideOverview';
import SummaryStats from './SummaryStats';
import PowertrainSummary from './PowertrainSummary';
import DrivingTips from './DrivingTips';
import MotorHistoryCharts from './MotorHistoryCharts';
import GForcePanel from './GForcePanel';
import PedalUsage from './PedalUsage';
import LiveMotorStatus from './LiveMotorStatus';
import SpeedGearPanel from './SpeedGearPanel';
import DynamicsTripToolbar from './DynamicsTripToolbar';
import { LiveSourceWarnings } from './LiveSourceWarnings';
import { SignedMotorReading } from './SignedMotorReading';

const fixture = vi.hoisted(() => ({
  length: 'km', temperature: 'C', precision: undefined as number | undefined, locale: 'en-US',
  history: {} as DataStateSource<MotorSnapshot[]>,
  motor: {} as DataStateSource<MotorSnapshot>,
  dynamics: {} as DataStateSource<DriveDynamicsSnapshot>,
  vehicle: {} as DataStateSource<undefined>,
  cruise: {} as DataStateSource<undefined>,
  follow: {} as DataStateSource<undefined>,
  historyCalls: vi.fn(), retry: vi.fn(), exportPNG: vi.fn(),
}));

vi.mock('@/hooks/useSettings', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useSettings')>();
  return { ...actual, useSettings: () => ({
    settings: {
      unit_of_length: fixture.length, unit_of_temp: fixture.temperature, unit_of_pressure: 'bar',
      locale: fixture.locale, decimal_precision: fixture.precision, currency_symbol: '$',
      chart_palette: 'cb_safe', theme: 'neon-cyan', mode: 'dark',
    },
  }) };
});
// Preserve every actual motion export. Only entrance visibility is isolated.
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return {
    ...actual,
    FadeIn: ({ children, className }: ComponentProps<typeof actual.FadeIn>) =>
      <div className={className}>{children}</div>,
  };
});
vi.mock('@/api/hooks/useVehicles', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/hooks/useVehicles')>();
  const view = <T,>(source: DataStateSource<T>) => ({
    ...source, isLoading: !source.data && !source.error, refetch: fixture.retry,
  });
  return {
    ...actual,
    useMotorHistory: (vehicleId: number, window: unknown) => {
      fixture.historyCalls(vehicleId, window);
      return view(fixture.history);
    },
    useMotorLatest: () => view(fixture.motor),
    useDriveDynamicsLatest: () => view(fixture.dynamics),
    useVehicleState: () => view(fixture.vehicle),
  };
});
vi.mock('@/api/hooks/useTelemetry', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useTelemetry')>(),
  useSignalObservations: (_id: number, options: { signal_name: string }) => ({
    ...(options.signal_name === 'CruiseSetSpeed' ? fixture.cruise : fixture.follow),
    refetch: fixture.retry,
  }),
}));
vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({
    chartRef: { current: null }, exportPNG: fixture.exportPNG,
    exportSVG: vi.fn(), copyToClipboard: vi.fn(), exporting: false,
  }),
}));
vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: () => ({ annotations: [] }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
  useDeleteAnnotation: () => ({ mutate: vi.fn() }),
}));

const drive: Drive = {
  id: 82, vehicleId: 7, startTs: '2026-10-01T10:00:00Z', endTs: '2026-10-01T11:00:00Z',
  durationS: 3600, distanceM: 1609.344, startAddress: 'Home', endAddress: 'Office',
  startLat: null, startLon: null, endLat: null, endLon: null,
  startBatteryPct: 80, endBatteryPct: 74, energyUsedWh: 2345, regenEnergyWh: 456,
  avgSpeedMps: 10, maxSpeedMps: 20, avgPowerW: 22000,
  outsideTempAvgC: null, insideTempAvgC: null, score: null, endedStatus: null,
  createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T11:00:00Z',
};
const sample: MotorSnapshot = {
  ts: drive.startTs, created_at: drive.startTs,
  torque_nm_front: -20, torque_nm_rear: 120, di_torque: null,
  motor_rpm_front: -100, motor_rpm_rear: 800,
  motor_temp_c_front: 40, motor_temp_c_rear: 49,
  inverter_temp_c: null, inverter_temp_rear: null,
  heatsink_temp_front: null, heatsink_temp_rear: null,
  motor_current_front: null, motor_current_rear: null,
  state_front: null, state_rear: null, shift_state: 'D',
  vbat_front: null, vbat_rear: null, power_kw: 42.345, regen_kw: 12.456,
};
const window = { enabled: true, start: drive.startTs, end: '2026-10-01T11:00:01.000Z', refetchInterval: false as const };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
// Wrapper remains applied by testing-library's rerender too: real ChartCard,
// ErrorDisplay, StatTile links and chart fullscreen all have Router context.
function providers({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/driving-dynamics']}>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  </MemoryRouter>;
}
function mount(ui: ReactNode) { return render(ui, { wrapper: providers }); }
function metric(label: string) {
  return screen.getByText(label).closest('[data-stat]') as HTMLElement;
}
beforeEach(() => {
  fixture.length = 'km'; fixture.temperature = 'C'; fixture.precision = undefined; fixture.locale = 'en-US';
  fixture.history = { data: [sample], isError: false, dataUpdatedAt: Date.now() };
  fixture.motor = { data: sample, isError: false };
  fixture.dynamics = { data: { lateral_acceleration: -0.3, longitudinal_acceleration: 0.4 }, isError: false };
  fixture.vehicle = {}; fixture.cruise = {}; fixture.follow = {};
  fixture.historyCalls.mockClear(); fixture.retry.mockClear();
  setGlobalLocale('en-US'); setGlobalPrecision(2);
  client.clear();
});

describe('resolved-empty telemetry recovery', () => {
  it.each([
    ['guidance', (enabled: boolean) => <DrivingTips vehicleId={7} historyQuery={{ ...window, enabled }} />],
    ['powertrain', (enabled: boolean) => <PowertrainSummary vehicleId={7} historyQuery={{ ...window, enabled }} />],
    ['motor charts', (enabled: boolean) => <MotorHistoryCharts vehicleId={7} historyQuery={{ ...window, enabled }} />],
  ] as const)('retries %s in the same drive window, but not disabled history', (_label, content) => {
    fixture.history = { data: [], isSuccess: true };
    const view = mount(content(true));
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]!);
    expect(fixture.retry).toHaveBeenCalledTimes(1);
    expect(fixture.historyCalls).toHaveBeenCalledWith(7, {
      limit: 200, ...window,
    });
    view.rerender(content(false));
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(fixture.retry).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['G-force', (id: number | null) => <GForcePanel vehicleId={id} />],
    ['pedals', (id: number | null) => <PedalUsage vehicleId={id} />],
    ['live motor', (id: number | null) => <LiveMotorStatus vehicleId={id} toTemperatureDisplay={v => v} tempUnit="°C" />],
  ] as const)('retries empty %s without allowing an unselected-vehicle request', (_label, content) => {
    fixture.dynamics = { data: {}, isSuccess: true };
    fixture.motor = { data: {} as MotorSnapshot, isSuccess: true };
    const view = mount(content(7));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(fixture.retry).toHaveBeenCalledTimes(1);
    view.rerender(content(null));
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});

describe('ride totals and display-only preferences', () => {
  it('retains all facts, route, timestamps, drill link and specialist caveat', () => {
    mount(<RideOverview drive={drive} />);
    expect(screen.getByText('Home → Office')).toBeInTheDocument();
    expect(metric('Distance')).toHaveTextContent('1.6');
    expect(metric('Duration')).toHaveTextContent('1');
    expect(metric('Energy used')).toHaveTextContent('2.35');
    expect(metric('Energy recovered')).toHaveTextContent('0.46');
    expect(screen.getByText(/Average \/ peak speed: 36 km\/h \/ 72 km\/h/)).toBeInTheDocument();
    expect(screen.getByText('Battery: 80.00% → 74.00%')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open trip details' })).toHaveAttribute('href', '/drives/82');
    expect(screen.getByText(/not peak regen power/)).toBeInTheDocument();
    expect(screen.getByText('Recorded trip')).toBeInTheDocument();
  });
  it('keeps default quantity precision and rerenders imperial/locale preferences without changing raw inputs', () => {
    const bytes = JSON.stringify(drive);
    const view = mount(<RideOverview drive={drive} />);
    fixture.length = 'mi'; fixture.precision = 3; fixture.locale = 'de-DE';
    view.rerender(<RideOverview drive={drive} />);
    expect(metric('Distance')).toHaveTextContent('1,000');
    expect(within(metric('Distance')).getByText('mi')).toBeInTheDocument();
    expect(metric('Energy used')).toHaveTextContent('2,345');
    expect(screen.getByText(/22,369 mph/)).toBeInTheDocument();
    expect(JSON.stringify(drive)).toBe(bytes);
  });
  it('keeps null, invalid and genuine zero distinct, then preserves the unselected shell', () => {
    const view = mount(<RideOverview drive={{ ...drive, energyUsedWh: 0, regenEnergyWh: null, distanceM: Number.NaN }} />);
    expect(metric('Energy used')).toHaveAttribute('data-state', 'value');
    expect(metric('Energy used')).toHaveTextContent('0.00');
    expect(metric('Energy recovered')).toHaveAttribute('data-state', 'missing');
    expect(metric('Distance')).toHaveAttribute('data-state', 'invalid');
    view.rerender(<RideOverview drive={null} />);
    expect(screen.getByTestId('dynamics-ride-overview')).toBeInTheDocument();
    expect(screen.getByText('Choose a trip with recorded data to review its outcome.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open trip details' })).not.toBeInTheDocument();
  });
  it('retains open-trip identity and the independent drive control callback', () => {
    mount(<RideOverview drive={{ ...drive, endTs: null, endAddress: null }} />);
    expect(screen.getByText('Home → On the road')).toBeInTheDocument();
    expect(screen.getByText('In progress · totals may change')).toBeInTheDocument();
  });
});

describe('sample statistics, selected bounds and retained trust', () => {
  it('keeps six metrics, derived SI quantities and both query bounds/default limit', () => {
    mount(<SummaryStats vehicleId={7} historyQuery={window} />);
    expect(document.querySelectorAll('#dynamics-motor-summary [data-stat]')).toHaveLength(6);
    expect(metric('Total Readings')).toHaveTextContent('1');
    expect(metric('Avg Torque')).toHaveTextContent('100.00');
    expect(metric('Avg Torque')).toHaveTextContent('Newton-metres (Nm)');
    expect(metric('Peak Power')).toHaveTextContent('42.35');
    expect(metric('Peak Regen')).toHaveTextContent('12.46');
    expect(metric('Avg Power')).toHaveTextContent('42.35');
    expect(metric('Avg Motor Temp')).toHaveTextContent('49.00');
    expect(fixture.historyCalls).toHaveBeenCalledWith(7, {
      limit: 200, enabled: true, start: window.start, end: window.end, refetchInterval: false,
    });
    expect(screen.getByText(/not a time-weighted or complete-trip assessment/)).toBeInTheDocument();
  });
  it('keeps number and temperature preference paths on rerender and leaves cache bytes intact', () => {
    const bytes = JSON.stringify(fixture.history.data);
    const view = mount(<SummaryStats vehicleId={7} historyQuery={window} />);
    fixture.temperature = 'F'; fixture.precision = 3;
    setGlobalPrecision(3); setGlobalLocale('de-DE');
    view.rerender(<SummaryStats vehicleId={7} historyQuery={window} />);
    expect(metric('Avg Motor Temp')).toHaveTextContent('120,200');
    expect(metric('Avg Torque')).toHaveTextContent('100,000');
    expect(metric('Peak Power')).toHaveTextContent('42.345');
    expect(JSON.stringify(fixture.history.data)).toBe(bytes);
  });
  it('retains powertrain facts and all four guidance explanations after a failed refresh', () => {
    const view = mount(<><PowertrainSummary vehicleId={7} historyQuery={window} />
      <DrivingTips vehicleId={7} historyQuery={window} /></>);
    fixture.history = { ...fixture.history, isError: true, error: new Error('refresh failed') };
    view.rerender(<><PowertrainSummary vehicleId={7} historyQuery={window} />
      <DrivingTips vehicleId={7} historyQuery={window} /></>);
    expect(screen.getByText(/Peak sampled power 42.35 kW; peak sampled regen 12.46 kW/)).toBeInTheDocument();
    expect(screen.getByText(/Peak reported axle torque 100.00 Nm; hottest recorded motor 49.0°C/)).toBeInTheDocument();
    expect(screen.getByText(/Driver inputs/)).toBeInTheDocument();
    expect(document.querySelectorAll('li[data-tone="info"]')).toHaveLength(4);
    expect(screen.getByText(/friction-brake use cannot be reconstructed/)).toBeInTheDocument();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });
  it('shows initial loading then actionable fatal error without unmounting panel shells', () => {
    fixture.history = { isPending: true, isFetching: true };
    const view = mount(<PowertrainSummary vehicleId={7} historyQuery={window} />);
    expect(screen.getByRole('status', { name: 'Loading selected-drive evidence' })).toBeInTheDocument();
    fixture.history = { isError: true, error: new Error('history unavailable') };
    view.rerender(<PowertrainSummary vehicleId={7} historyQuery={window} />);
    expect(screen.getByTestId('dynamics-powertrain-summary')).toBeInTheDocument();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(fixture.retry).toHaveBeenCalled();
  });
  it('renders real zeros and unknown all-null sample fields, not made-up averages', () => {
    fixture.history.data = [{ ...sample, power_kw: 0, regen_kw: null,
      torque_nm_front: null, torque_nm_rear: null,
      motor_temp_c_front: null, motor_temp_c_rear: Number.NaN }];
    mount(<SummaryStats vehicleId={7} historyQuery={window} />);
    expect(metric('Peak Power')).toHaveAttribute('data-state', 'value');
    expect(metric('Peak Power')).toHaveTextContent('0.00');
    for (const label of ['Peak Regen', 'Avg Torque', 'Avg Motor Temp']) {
      expect(metric(label)).toHaveAttribute('data-state', 'missing');
      expect(metric(label)).toHaveTextContent('—');
    }
  });
});

describe('signed live physics and independent errors', () => {
  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'uses the shared nullable track without a counterfeit zero for %s', value => {
      const view = mount(<SignedMotorReading value={value} label="Signed fixture" min={400} max={1000}
        unit=" Nm" negativeLabel="Regen" positiveLabel="Drive" />);
      const group = screen.getByRole('group', { name: 'Signed fixture' });
      expect(group).not.toHaveAttribute('aria-valuenow');
      expect(group.querySelector('[data-bipolar-track]')).toBeInTheDocument();
      expect(group.querySelector('[data-bipolar-fill]')).not.toBeInTheDocument();
      expect(group).toHaveTextContent('Regen');
      expect(group).toHaveTextContent('Drive');
      view.rerender(<SignedMotorReading value={0} label="Signed fixture" min={400} max={1000} unit=" Nm" />);
      expect(screen.getByRole('meter', { name: 'Signed fixture' })).toHaveAttribute('aria-valuenow', '0');
    },
  );
  it('retains signed axes and the both-axis magnitude across refresh failure', () => {
    const view = mount(<GForcePanel vehicleId={7} />);
    expect(metric('Lateral')).toHaveTextContent('-0.30');
    expect(metric('Longitudinal')).toHaveTextContent('0.40');
    expect(metric('Combined')).toHaveTextContent('0.50');
    fixture.dynamics.error = new Error('dynamics refresh failed'); fixture.dynamics.isError = true;
    view.rerender(<GForcePanel vehicleId={7} />);
    expect(metric('Combined')).toHaveTextContent('0.50');
    fixture.dynamics.data = { lateral_acceleration: 0, longitudinal_acceleration: null };
    view.rerender(<GForcePanel vehicleId={7} />);
    expect(metric('Lateral')).toHaveAttribute('data-state', 'value');
    expect(metric('Lateral')).toHaveTextContent('0.00');
    expect(metric('Combined')).toHaveAttribute('data-state', 'missing');
  });
  it('never promotes an invalid axis into a magnitude or fabricates an observation timestamp', () => {
    fixture.dynamics.data = { lateral_acceleration: Number.NaN, longitudinal_acceleration: -0.4 };
    mount(<GForcePanel vehicleId={7} />);
    expect(metric('Lateral')).toHaveAttribute('data-state', 'missing');
    expect(metric('Combined')).toHaveAttribute('data-state', 'missing');
    expect(metric('Longitudinal')).toHaveTextContent('-0.40');
    expect(document.querySelector('[data-period-kind="snapshot"]')).toBeInTheDocument();
  });
  it('preserves pedal false/true/unknown and distinguishes invalid position from known zero', () => {
    fixture.dynamics.data = { pedal_position: 0, brake_pedal_position: Number.NaN, brake_pedal_active: false };
    const view = mount(<PedalUsage vehicleId={7} />);
    expect(screen.getByText('Brake Inactive')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Throttle' })).toHaveAttribute('aria-valuetext', '0.00%');
    expect(screen.getByRole('group', { name: 'Brake' })).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByRole('group', { name: 'Brake' })).toHaveTextContent('—');
    fixture.dynamics.data = { pedal_position: 0, brake_pedal_active: true };
    view.rerender(<PedalUsage vehicleId={7} />);
    expect(screen.getByText('Brake Active')).toBeInTheDocument();
    fixture.dynamics.data = { pedal_position: 0, brake_pedal_active: null };
    view.rerender(<PedalUsage vehicleId={7} />);
    expect(screen.getByText('Brake Unknown')).toBeInTheDocument();
  });
  it('keeps asymmetric signed motor scales, temperature offset, gear and unknown RPM', () => {
    fixture.motor.data = { ...sample, torque_nm_front: -120, torque_nm_rear: 0, motor_rpm_rear: null };
    const view = mount(<LiveMotorStatus vehicleId={7} toTemperatureDisplay={v => v} tempUnit="°C" />);
    expect(screen.getByRole('meter', { name: 'Torque' })).toHaveAttribute('aria-valuemin', '-400');
    expect(screen.getByRole('meter', { name: 'Torque' })).toHaveAttribute('aria-valuemax', '1000');
    expect(screen.getByRole('meter', { name: 'Torque' })).toHaveAttribute('aria-valuetext', '-120.00 Nm');
    expect(screen.getByRole('meter', { name: 'Front RPM' })).toHaveAttribute('aria-valuemin', '-3000');
    expect(screen.getByRole('group', { name: 'Rear RPM' })).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByRole('group', { name: 'Rear RPM' })).toHaveTextContent('—');
    view.rerender(<LiveMotorStatus vehicleId={7} toTemperatureDisplay={v => v * 9 / 5 + 32} tempUnit="°F" />);
    expect(screen.getByRole('meter', { name: 'Motor' })).toHaveAttribute('aria-valuemin', '32');
    expect(screen.getByRole('meter', { name: 'Motor' })).toHaveAttribute('aria-valuemax', '302');
    expect(screen.getByText('120.20°F')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
  });
  it('keeps trip speeds arithmetic in SI and current motor power separate', () => {
    mount(<SpeedGearPanel vehicleId={7} filteredDrives={[drive, { ...drive, id: 83, avgSpeedMps: 0, maxSpeedMps: 0 }]} />);
    expect(metric('Avg Drive Speed')).toHaveTextContent('18.00');
    expect(metric('Top Drive Speed')).toHaveTextContent('72.00');
    expect(metric('Motor Power')).toHaveTextContent('42.35');
    expect(document.querySelector('#dynamics-current-motor-power')).toHaveAttribute('data-period-kind', 'snapshot');
    expect(document.querySelector('#dynamics-range-speeds')).toHaveAttribute('data-period-kind', 'unknown');
  });
  it('surfaces independent state/cruise/follow failures without dropping motor/dynamics neighbors', () => {
    fixture.vehicle = { error: new Error('speed failed'), isError: true };
    fixture.cruise = { error: new Error('cruise failed'), isError: true };
    fixture.follow = { error: new Error('follow failed'), isError: true };
    mount(<><LiveSourceWarnings vehicleId={7} /><GForcePanel vehicleId={7} /></>);
    for (const label of ['Current Speed', 'Cruise Set Speed', 'Follow Distance']) {
      const source = screen.getByRole('region', { name: label });
      expect(within(source).getByText("Can't reach server")).toBeInTheDocument();
      expect(within(source).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    }
    expect(metric('Combined')).toHaveTextContent('0.50');
  });
});

describe('shared chart policy and independent drive control', () => {
  it('keeps all three real chart shells and controls through retained failure', () => {
    const view = mount(<MotorHistoryCharts vehicleId={7} historyQuery={window} />);
    for (const label of ['Motor Power Over Time', 'Motor Torque History', 'Motor RPM History']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByRole('button', { name: 'Export chart' })).toHaveLength(3);
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(3);
    expect(view.container.querySelectorAll('[data-chart-toolbar]')).toHaveLength(3);
    // The captured callers omit fullscreen; preserve that default policy.
    expect(screen.queryByRole('button', { name: /fullscreen/i })).not.toBeInTheDocument();
    fixture.history.error = new Error('chart refresh failed'); fixture.history.isError = true;
    view.rerender(<MotorHistoryCharts vehicleId={7} historyQuery={window} />);
    expect(screen.getAllByRole('button', { name: 'Export chart' })).toHaveLength(3);
    fireEvent.click(screen.getAllByRole('button', { name: 'Export chart' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save as PNG' }));
    expect(fixture.exportPNG).toHaveBeenCalled();
    expect(screen.queryByText('Awaiting motor telemetry data...')).not.toBeInTheDocument();
  });
  it('wraps real ChartCard and ErrorDisplay on both mount and error rerender', () => {
    const view = mount(<ChartCard title="Test chart" ariaLabel="Test chart figure" empty><span /></ChartCard>);
    view.rerender(<ChartCard title="Test chart" ariaLabel="Test chart figure" error={new Error('shared chart failed')}><span /></ChartCard>);
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    // This read-only caller deliberately does not opt into fullscreen.
    expect(screen.queryByRole('button', { name: /fullscreen/i })).not.toBeInTheDocument();
  });
  it('preserves drive field identity/callback and uses unknown distance, not zero', () => {
    const select = vi.fn();
    mount(<DynamicsTripToolbar startDate="2026-10-01" endDate="2026-10-02"
      drives={[{ ...drive, distanceM: Number.NaN }]} selectedDriveId="82" onSelectDrive={select} />);
    expect(screen.getByLabelText('Drive')).toHaveAttribute('id', 'dynamics-drive');
    fireEvent.change(screen.getByLabelText('Drive'), { target: { value: '82' } });
    expect(select).toHaveBeenCalledWith('82');
    expect(screen.getByRole('option', { name: /· —/ })).toBeInTheDocument();
  });
});
