import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import type { Drive } from '@/types/driving';

const source = vi.hoisted(() => ({
  query: {} as DataStateSource<Drive[]>,
  retry: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
        fallback,
      ),
  }),
}));
vi.mock('@/api/hooks/useDriving', () => ({
  useDriveCalendarHistory: () => source.query,
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/features/onboarding/components/NoVehicleSelected', () => ({
  NoVehicleSelected: () => null,
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 42 }),
}));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({ start: '2025-01-01', end: '2025-01-07', timezone: 'UTC' }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { locale: 'en', distance: 'km' },
    formatDistance: (value: number | null) => value == null ? 'unknown' : String(value),
    formatDuration: (value: number | null) => value == null ? 'unknown' : String(value),
  }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtNumber: String, fmtInt: String }),
}));
vi.mock('@/components/layout', () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Grid: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/ui', () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { GlassPanel: Wrapper, PanelTitle: Wrapper, Text: Wrapper, Badge: Wrapper, Button: Wrapper };
});
vi.mock('@/components/feedback', () => ({
  SectionErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
  StaleRefreshWarning: () => null,
  AlertBanner: ({ title, children }: { title: string; children: ReactNode }) =>
    <div><span>{title}</span>{children}</div>,
  QueryError: () => <div>Fatal source error</div>,
  Skeleton: () => <div>Loading source</div>,
  EmptyState: ({ message }: { message: string }) => <div>{message}</div>,
}));
vi.mock('../operationalbrief-a-m/DrivingRhythmBrief', () => ({
  DrivingRhythmBrief: () => null,
}));
vi.mock('../operationalbrief-a-m/NestedDrivingBrief', () => ({
  NestedDrivingBrief: (props: {
    title: string;
    retained?: boolean;
    loading?: boolean;
    unavailable?: boolean;
    metrics: readonly { occurrenceId?: string; rawValue: number | null }[];
  }) => (
    <div data-testid="nested-brief" data-retained={String(props.retained)}
      data-loading={String(props.loading)} data-unavailable={String(props.unavailable)}>
      {props.title}
      {props.metrics.map(metric => (
        <span key={metric.occurrenceId} data-testid={metric.occurrenceId}>
          {metric.rawValue == null ? 'unknown' : String(metric.rawValue)}
        </span>
      ))}
    </div>
  ),
}));
vi.mock('./index', async () => ({
  DepartureConsistency: (await import('./DepartureConsistency')).DepartureConsistency,
  WeekdayWeekendComparison: (await import('./WeekdayWeekendComparison')).WeekdayWeekendComparison,
  DrivingRhythmMethodology: (await import('./DrivingRhythmMethodology')).DrivingRhythmMethodology,
  WeeklyPunchcard: () => null,
  HourlyDistribution: () => null,
  MonthlyRhythmTrend: () => null,
  StrongestSlots: () => null,
}));

import DrivingRhythmPage from '../../pages/DrivingRhythmPage';

const rows: Drive[] = [1, 2].map(id => ({
  id, vehicleId: 42, startTs: `2025-01-0${id}T08:00:00Z`,
  endTs: null, durationS: 600, distanceM: 0,
  startAddress: null, endAddress: null,
  startLat: null, startLon: null, endLat: null, endLon: null,
  startBatteryPct: null, endBatteryPct: null,
  energyUsedWh: null, regenEnergyWh: null,
  avgSpeedMps: null, maxSpeedMps: null, avgPowerW: null,
  outsideTempAvgC: null, insideTempAvgC: null,
  score: null, endedStatus: null, createdAt: '', updatedAt: '',
}));

function setSource(overrides: DataStateSource<Drive[]> = {}) {
  source.query = {
    data: rows, isSuccess: true, fetchStatus: 'idle', dataUpdatedAt: 1,
    refetch: source.retry, ...overrides,
  };
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('driving rhythm nested source trust', () => {
  it.each(['fetching', 'paused'] as const)(
    'does not claim returned zero evidence before an initial %s source resolves',
    fetchStatus => {
      setSource({ data: undefined, isSuccess: false, isPending: true, fetchStatus });
      render(<DrivingRhythmPage />);
      expect(screen.queryAllByTestId('nested-brief')).toHaveLength(0);
      expect(screen.getAllByText('Loading source')).toHaveLength(3);
      expect(screen.queryByText('Complete selected history')).not.toBeInTheDocument();
      if (fetchStatus === 'paused') {
        expect(screen.getByText('The initial evidence query is paused; no empty result is inferred.')).toBeInTheDocument();
      } else {
        expect(screen.queryByText('The initial evidence query is paused; no empty result is inferred.')).not.toBeInTheDocument();
      }
    },
  );

  it('treats a successful empty window as returned coverage, not unavailable evidence', () => {
    setSource({ data: [] });
    render(<DrivingRhythmPage />);
    expect(screen.getAllByTestId('nested-brief')).toHaveLength(1);
    expect(screen.getByTestId('returned')).toHaveTextContent('0');
    expect(screen.getByTestId('included')).toHaveTextContent('0');
    expect(screen.getByTestId('nested-brief')).toHaveAttribute('data-retained', 'false');
    expect(screen.getByTestId('nested-brief')).toHaveAttribute('data-unavailable', 'false');
  });

  it.each([
    { error: new Error('Refresh failed'), isError: true },
    { fetchStatus: 'paused' as const },
  ])('keeps all three nested consumer rows and pagination coverage through retention and recovery', failure => {
    setSource();
    const view = render(<DrivingRhythmPage />);
    const originalMetrics = screen.getAllByTestId('nested-brief').map(node => node.textContent);
    expect(originalMetrics).toHaveLength(10);
    expect(screen.getByTestId('weekday-distance')).toHaveTextContent('0');
    expect(screen.getByTestId('returned')).toHaveTextContent('2');

    setSource(failure);
    view.rerender(<DrivingRhythmPage />);
    for (const brief of screen.getAllByTestId('nested-brief')) {
      expect(brief).toHaveAttribute('data-retained', 'true');
      expect(brief).toHaveAttribute('data-loading', 'false');
      expect(brief).toHaveAttribute('data-unavailable', 'false');
    }
    expect(screen.getAllByTestId('nested-brief').map(node => node.textContent)).toEqual(originalMetrics);
    expect(screen.getByText('Complete selected history')).toBeInTheDocument();
    expect(screen.queryByText('Fatal source error')).not.toBeInTheDocument();

    setSource({ isFetching: true, fetchStatus: 'fetching', ...failure });
    view.rerender(<DrivingRhythmPage />);
    expect(screen.getAllByTestId('nested-brief').map(node => node.textContent)).toEqual(originalMetrics);

    setSource({ dataUpdatedAt: 2 });
    view.rerender(<DrivingRhythmPage />);
    for (const brief of screen.getAllByTestId('nested-brief')) {
      expect(brief).toHaveAttribute('data-retained', 'false');
    }
    expect(screen.getAllByTestId('nested-brief').map(node => node.textContent)).toEqual(originalMetrics);
  });

  it('replaces only an initial fatal source failure, without inventing coverage counts', () => {
    setSource({ data: undefined, error: new Error('Initial failure'), isError: true });
    render(<DrivingRhythmPage />);
    expect(screen.getAllByText('Fatal source error')).toHaveLength(3);
    expect(screen.queryAllByTestId('nested-brief')).toHaveLength(0);
  });
});
