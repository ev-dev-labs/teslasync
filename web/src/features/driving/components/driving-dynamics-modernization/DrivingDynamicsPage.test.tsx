import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Drive } from '@/types/driving';
import type { DataStateSource } from '@/api/dataState';
import DrivingDynamicsPage from '../../pages/DrivingDynamicsPage';

const source = vi.hoisted(() => ({
  range: {} as DataStateSource<Drive[]>, latest: {} as DataStateSource<Drive[]>,
  driveParam: undefined as string | undefined,
  driveCalls: vi.fn(), signalCalls: vi.fn(), setDrive: vi.fn(), retry: vi.fn(),
  presentations: new Map<string, Record<string, unknown>>(),
}));
vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: (id: string, options: { start?: string }) => {
    source.driveCalls(id, options);
    return { ...(options.start ? source.range : source.latest), refetch: source.retry };
  },
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: 7 }) }));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({
    start: '2026-10-01', end: '2026-10-02',
    startInstant: '2026-10-01T07:00:00Z', endInstantExclusive: '2026-10-03T07:00:00Z',
  }),
}));
vi.mock('@/hooks/useUrlState', () => ({ useUrlString: () => [source.driveParam, source.setDrive] }));
vi.mock('@/hooks/useSignalQueryInvalidation', () => ({ useSignalQueryInvalidation: source.signalCalls }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/layout', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/layout')>();
  return { ...actual, PageLayout: ({ title, children }: ComponentProps<typeof actual.PageLayout>) =>
    <section aria-label={title}>{children}</section> };
});
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return { ...actual, FadeIn: ({ children, className }: ComponentProps<typeof actual.FadeIn>) =>
    <div className={className}>{children}</div> };
});
vi.mock('../driving-dynamics', () => {
  const presenter = (name: string) => (props: Record<string, unknown>) => {
    source.presentations.set(name, props);
    return <div data-testid={name} />;
  };
  return {
    AutopilotSection: presenter('AutopilotSection'),
    MotorEfficiencyInsights: presenter('MotorEfficiencyInsights'),
    DrivingCoachSection: presenter('DrivingCoachSection'),
    DriveAnalyticsSection: presenter('DriveAnalyticsSection'),
    GrokDynamicsBriefing: presenter('GrokDynamicsBriefing'),
  };
});
vi.mock('../operationalbrief-a-m/MotorSamplesBrief', () => ({
  MotorSamplesBrief: (props: Record<string, unknown>) => {
    source.presentations.set('MotorSamplesBrief', props);
    return <div data-testid="MotorSamplesBrief" />;
  },
}));
vi.mock('./index', () => {
  const presenter = (name: string) => (props: Record<string, unknown>) => {
    source.presentations.set(name, props);
    return <div data-testid={name} />;
  };
  return {
    DynamicsPlacement: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    LiveSourceWarnings: presenter('LiveSourceWarnings'),
    DynamicsTripToolbar: presenter('DynamicsTripToolbar'),
    RideOverview: presenter('RideOverview'),
    PowertrainSummary: presenter('PowertrainSummary'),
    MotorHistoryCharts: presenter('MotorHistoryCharts'),
    DrivingTips: presenter('DrivingTips'),
    GForcePanel: presenter('GForcePanel'),
    LiveMotorStatus: presenter('LiveMotorStatus'),
    PedalUsage: presenter('PedalUsage'),
    SpeedGearPanel: presenter('SpeedGearPanel'),
  };
});
const drive: Drive = {
  id: 82, vehicleId: 7, startTs: '2026-10-01T10:00:00Z', endTs: '2026-10-01T11:00:00Z',
  durationS: 3600, distanceM: 1609.344, startAddress: 'Home', endAddress: 'Office',
  startLat: null, startLon: null, endLat: null, endLon: null,
  startBatteryPct: 80, endBatteryPct: 74, energyUsedWh: 2345, regenEnergyWh: 456,
  avgSpeedMps: 10, maxSpeedMps: 20, avgPowerW: 22000,
  outsideTempAvgC: null, insideTempAvgC: null, score: null, endedStatus: null,
  createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T11:00:00Z',
};
let queryClient: QueryClient;
function mount() {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<DrivingDynamicsPage />, { wrapper: Wrapper });
}
beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  source.range = { data: [drive], isLoading: false };
  source.latest = { data: [], isLoading: false };
  source.driveParam = undefined;
  source.presentations.clear(); source.driveCalls.mockClear(); source.signalCalls.mockClear();
});
afterEach(async () => {
  cleanup();
  await queryClient.cancelQueries();
  queryClient.clear();
});

describe('Driving Dynamics full source orchestration', () => {
  it('keeps all fifteen original presenters plus source notices, bounds and coach policy', () => {
    mount();
    const names = ['DynamicsTripToolbar', 'RideOverview', 'PowertrainSummary', 'MotorSamplesBrief',
      'MotorEfficiencyInsights', 'MotorHistoryCharts', 'DrivingTips', 'LiveMotorStatus',
      'PedalUsage', 'GrokDynamicsBriefing', 'SpeedGearPanel', 'GForcePanel', 'AutopilotSection',
      'DrivingCoachSection', 'DriveAnalyticsSection'];
    for (const name of names) expect(screen.getByTestId(name)).toBeInTheDocument();
    expect(source.driveCalls).toHaveBeenCalledWith('7', {
      start: '2026-10-01T07:00:00Z', end: '2026-10-03T07:00:00Z', limit: 1000, refetchInterval: 30000,
    });
    expect(source.driveCalls).toHaveBeenCalledWith('7', { limit: 5, refetchInterval: 30000 });
    expect(source.presentations.get('DrivingCoachSection')).toEqual({ vehicleId: '7', showPerDriveScores: false });
    for (const name of ['PowertrainSummary', 'MotorSamplesBrief', 'MotorEfficiencyInsights', 'MotorHistoryCharts', 'DrivingTips']) {
      expect(source.presentations.get(name)?.historyQuery).toEqual({
        start: drive.startTs, end: '2026-10-01T11:00:01.000Z', enabled: true, refetchInterval: false,
      });
    }
    expect(source.signalCalls).toHaveBeenCalledWith(expect.objectContaining({
      vehicleId: 7, bindings: expect.arrayContaining([
        expect.objectContaining({ queryKey: ['motor-latest', 7] }),
        expect.objectContaining({ queryKey: ['drive-dynamics-latest', 7] }),
        expect.objectContaining({ queryKey: ['signal-observations', 7] }),
      ]),
    }));
    expect(screen.getByRole('heading', { name: 'Inside this ride' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vehicle now' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Beyond this ride' })).toBeInTheDocument();
    // Target workspace controls, not the named Vehicle now / date-range
    // sections that must remain visible. Keep the independent drive selector.
    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Analysis window:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'View settings' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Start date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('End date')).not.toBeInTheDocument();
  });
  it('keeps selected identity, all raw drive facts and the URL callback', () => {
    source.driveParam = '82';
    mount();
    expect(source.presentations.get('RideOverview')?.drive).toBe(drive);
    expect(source.presentations.get('DriveAnalyticsSection')?.filteredDrives).toEqual([drive]);
    const toolbar = source.presentations.get('DynamicsTripToolbar');
    expect(toolbar?.selectedDriveId).toBe('82');
    const change = toolbar?.onSelectDrive as (id: string) => void;
    change('83');
    expect(source.setDrive).toHaveBeenCalledWith('83');
  });
  it('retains all shells on initial load, empty and independent source failures, including rerender', () => {
    source.range = { isLoading: true, isPending: true };
    source.latest = { isLoading: true, isPending: true };
    const view = mount();
    expect(source.presentations.get('MotorSamplesBrief')?.historyQuery).toEqual({ enabled: false });
    source.range = { data: [] }; source.latest = { data: [] };
    view.rerender(<DrivingDynamicsPage />);
    expect(source.presentations.get('RideOverview')?.drive).toBeNull();
    expect(screen.getByTestId('AutopilotSection')).toBeInTheDocument();
    source.range = { data: [drive], isError: true, error: new Error('range refresh failed') };
    source.latest = { isError: true, error: new Error('latest failed') };
    view.rerender(<DrivingDynamicsPage />);
    expect(source.presentations.get('RideOverview')?.drive).toBe(drive);
    expect(screen.getByTestId('DrivingCoachSection')).toBeInTheDocument();
    expect(screen.getByTestId('DriveAnalyticsSection')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
  });
  it('still merges an open latest drive and uses the live history polling policy', () => {
    const open = { ...drive, id: 83, endTs: null, live: true };
    source.latest = { data: [open] };
    mount();
    expect(source.presentations.get('RideOverview')?.drive).toBe(open);
    expect(source.presentations.get('MotorSamplesBrief')?.historyQuery).toEqual(expect.objectContaining({
      enabled: true, start: drive.startTs, refetchInterval: 30000,
    }));
    expect(source.presentations.get('DriveAnalyticsSection')?.filteredDrives).toEqual([open, drive]);
  });
});
