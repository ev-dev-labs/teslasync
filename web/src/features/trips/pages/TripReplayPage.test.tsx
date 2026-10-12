import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';
import type { DriveDetail, DrivePosition } from '@/types/driving';
import type { PlaybackControlsProps } from '@/components/data-display/PlaybackControls';
import type { TripReplayMapProps } from '../components/TripReplayMap';
import type { TripReplayCharts } from '../components/TripReplayCharts';
import type { TripReplayElevation } from '../components/TripReplayElevation';
import { chartTokens } from '@/lib/tokens';

const { useDriveMock, captured } = vi.hoisted(() => ({
  useDriveMock: vi.fn(),
  captured: {
    map: null as TripReplayMapProps | null,
    playback: null as PlaybackControlsProps | null,
    charts: null as ComponentProps<typeof TripReplayCharts> | null,
    elevation: null as ComponentProps<typeof TripReplayElevation> | null,
    summary: null as { drive?: DriveDetail } | null,
    sparkline: null as { data: number[]; color: string } | null,
  },
}));

vi.mock('@/api/hooks/useDriving', () => ({ useDrive: useDriveMock }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: () => undefined }));
vi.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => ({ reduce: true }) }));
vi.mock('@/components/layout', () => ({
  PageLayout: ({ children, secondaryActions }: { children: ReactNode; secondaryActions: ReactNode }) =>
    <main>{secondaryActions}{children}</main>,
}));
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/features/trips/components/TripReplayMap', () => ({
  TripReplayMap: (props: TripReplayMapProps) => {
    captured.map = props;
    return <div data-testid="map" />;
  },
}));
vi.mock('@/features/trips/components/TripReplayCharts', () => ({
  TripReplayCharts: (props: ComponentProps<typeof TripReplayCharts>) => {
    captured.charts = props;
    return <div data-testid="timeline" />;
  },
}));
vi.mock('@/features/trips/components/TripReplayElevation', () => ({
  TripReplayElevation: (props: ComponentProps<typeof TripReplayElevation>) => {
    captured.elevation = props;
    return <div data-testid="elevation" />;
  },
}));
vi.mock('../components/operationalbrief-all/TripReplaySummaryBrief', () => ({
  TripReplaySummaryBrief: (props: { drive?: DriveDetail }) => {
    captured.summary = props;
    return <div data-testid="summary" />;
  },
}));
vi.mock('@/components/data-display', () => ({
  PlaybackControls: (props: PlaybackControlsProps) => {
    captured.playback = props;
    return <div data-testid="transport">{props.scrubberBackground}</div>;
  },
}));
vi.mock('@/components/charts', () => ({
  Sparkline: (props: { data: number[]; color: string }) => {
    captured.sparkline = props;
    return <div data-testid="speed-decoration" />;
  },
}));

import TripReplayPage from './TripReplayPage';

function position(index: number, overrides: Partial<DrivePosition> = {}): DrivePosition {
  return {
    latitude: 1 + index / 100, longitude: 2 + index / 100,
    timestamp: new Date(Date.UTC(2024, 0, 1, 0, index)).toISOString(),
    speed: 10, power: 5, batteryLevel: 80, elevation: null,
    insideTemp: null, outsideTemp: null, idealRange: null, ratedRange: null,
    odometer: null, fanStatus: null, isClimateOn: null, ...overrides,
  };
}

function drive(id: number, positions: DrivePosition[]): DriveDetail {
  return {
    id, vehicleId: 4, positions, telemetry: [],
    startTs: positions[0]?.timestamp ?? '2024-01-01T00:00:00Z',
    endTs: positions.at(-1)?.timestamp ?? null,
    durationS: 180, distanceM: 1234.5678,
    startAddress: null, endAddress: null, startLat: null, startLon: null,
    endLat: null, endLon: null, startBatteryPct: null, endBatteryPct: null,
    energyUsedWh: 123.4567, regenEnergyWh: null,
    avgSpeedMps: null, maxSpeedMps: null, avgPowerW: null,
    outsideTempAvgC: null, insideTempAvgC: null, score: null, endedStatus: null,
    createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
  };
}

let currentDrive: DriveDetail;
let navigate: ReturnType<typeof useNavigate>;

function RouteProbe() {
  navigate = useNavigate();
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function mount(route = '/drives/7/replay') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <RouteProbe />
      <Routes><Route path="/drives/:id/replay" element={<TripReplayPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  currentDrive = drive(7, [position(0), position(1), position(2), position(3)]);
  for (const key of Object.keys(captured) as (keyof typeof captured)[]) captured[key] = null;
  useDriveMock.mockImplementation(() => ({
    data: currentDrive, isLoading: false, isFetching: false, isStale: false,
    isError: false, error: null, dataUpdatedAt: 1_000, refetch: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TripReplayPage local modernization regressions', () => {
  it('rejects missing, nonfinite and out-of-bounds coordinates without fabricating a route', () => {
    const missingLatitude = position(0);
    Reflect.deleteProperty(missingLatitude, 'latitude');
    const missingLongitude = position(1);
    Reflect.deleteProperty(missingLongitude, 'longitude');
    currentDrive.positions = [
      missingLatitude, missingLongitude, position(2, { latitude: NaN }),
      position(3, { longitude: Infinity }), position(4, { latitude: 90.01 }),
      position(5, { longitude: -180.01 }), position(6),
    ];
    mount();
    expect(captured.map?.positions).toHaveLength(1);
    expect(captured.map?.positions[0]).toMatchObject({ latitude: 1.06, longitude: 2.06 });
    expect(currentDrive.positions).toHaveLength(7);
  });

  it('retains measured zero coordinates and geographic boundary coordinates', () => {
    currentDrive.positions = [
      position(0, { latitude: 0, longitude: 0 }),
      position(1, { latitude: 0, longitude: 10 }),
      position(2, { latitude: -90, longitude: -180 }),
      position(3, { latitude: 90, longitude: 180 }),
    ];
    mount();
    expect(captured.map?.positions.map((p) => [p.latitude, p.longitude]))
      .toEqual([[0, 0], [0, 10], [-90, -180], [90, 180]]);
  });

  it.each([
    { name: 'null speed', speed: null },
    { name: 'nonfinite speed', speed: NaN },
  ])('omits only the speed decoration for $name and preserves every timeline sample', ({ speed }) => {
    currentDrive.positions[1].speed = speed;
    mount();
    expect(screen.queryByTestId('speed-decoration')).not.toBeInTheDocument();
    expect(captured.map?.positions).toHaveLength(4);
    expect(captured.charts?.data).toHaveLength(4);
    expect(captured.elevation?.data).toHaveLength(4);
    expect(screen.getByTestId('transport')).toBeInTheDocument();
    if (speed === null) expect(captured.charts?.data[1].speed).toBeNull();
  });

  it('keeps measured zero speed and restrained paint without changing raw SI or specialist power', () => {
    currentDrive.positions[0] = position(0, { speed: 0, power: -8.7654 });
    mount();
    expect(captured.sparkline).toEqual({ data: [0, 10, 10, 10], color: chartTokens.series[0], height: 24, width: 400 });
    expect(captured.map?.positions[0]).toMatchObject({ speed: 0, power: -8.7654 });
    expect(captured.summary?.drive).toBe(currentDrive);
    expect(currentDrive.distanceM).toBe(1234.5678);
    expect(currentDrive.energyUsedWh).toBe(123.4567);
    expect(captured.playback?.getPreviewAt?.(0)?.power).toContain('-8.77');
  });

  it('restores each drive identity with equal sample counts and cancels the previous URL write', () => {
    mount('/drives/7/replay?at=0.25&keep=first');
    expect(captured.playback?.progress).toBe(0.25);
    act(() => captured.playback?.onSeek(0.4));
    currentDrive = drive(8, [position(10), position(11), position(12), position(13)]);
    act(() => navigate('/drives/8/replay?at=0.75&play=1&keep=second'));
    expect(captured.playback?.progress).toBe(0.75);
    expect(captured.playback?.isPlaying).toBe(true);
    act(() => captured.playback?.onPause());
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByTestId('location').textContent).toBe('/drives/8/replay?at=0.750&keep=second');
    expect(captured.map?.currentIndex).toBe(captured.charts?.currentIndex);
    expect(captured.map?.currentIndex).toBe(captured.elevation?.currentIndex);
  });

  it('preserves stored totals and empty GPS feedback when no usable coordinates remain', () => {
    currentDrive.positions = [position(0, { latitude: Infinity })];
    mount();
    expect(captured.summary?.drive).toBe(currentDrive);
    expect(screen.getByText(/No GPS data available for this drive/)).toBeInTheDocument();
    expect(screen.queryByTestId('transport')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Drive' })).toHaveAttribute('href', '/drives/7');
    expect(screen.getByRole('button', { name: 'Refresh replay data' })).toHaveClass('min-h-11', 'min-w-11');
  });
});
