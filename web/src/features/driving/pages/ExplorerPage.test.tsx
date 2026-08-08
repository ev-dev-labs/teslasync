import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Drive } from '@/types/driving';
import type { ExplorerSummary } from '../lib/explorer';

interface StateProbe {
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

const {
  formatDistanceMock,
  historyMock,
  pageTitleMock,
  refetchMock,
  sectionStates,
  selectedVehicleMock,
  unitsMock,
} = vi.hoisted(() => ({
  formatDistanceMock: vi.fn(),
  historyMock: vi.fn(),
  pageTitleMock: vi.fn(),
  refetchMock: vi.fn(),
  sectionStates: [] as StateProbe[],
  selectedVehicleMock: vi.fn(),
  unitsMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) =>
          text.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      ),
  }),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDriveHistory: (...args: unknown[]) => historyMock(...args),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => selectedVehicleMock(),
}));

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: (title: string) => pageTitleMock(title),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => unitsMock(),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

vi.mock('@/components/layout', () => ({
  PageContainer: ({
    title,
    subtitle,
    actions,
    children,
  }: {
    title: string;
    subtitle: string;
    actions: ReactNode;
    children: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {actions}
      {children}
    </main>
  ),
  Grid: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/onboarding/components/NoVehicleSelected', () => ({
  NoVehicleSelected: ({ pageTitle }: { pageTitle: string }) => (
    <div data-testid="no-vehicle">{pageTitle}</div>
  ),
}));

vi.mock('../components/explorer', () => {
  interface ProbeProps {
    summary: ExplorerSummary;
    state: StateProbe;
    formatDistance?: (value: number) => string;
  }
  const status = (props: ProbeProps) =>
    props.state.error
      ? 'error'
      : props.state.isLoading
        ? 'loading'
        : props.summary.eligibility.eligible === 0
          ? 'empty'
          : 'ready';
  const section = (testId: string, props: ProbeProps) => {
    sectionStates.push(props.state);
    return <section data-testid={testId}>{status(props)}</section>;
  };

  return {
    ExplorerKpis: (props: ProbeProps) => {
      sectionStates.push(props.state);
      const radius = props.summary.radiusM;
      return (
        <section
          data-testid="explorer-kpis"
          data-model-radius={radius ?? undefined}
        >
          {status(props)}
          {radius != null && props.formatDistance
            ? props.formatDistance(radius)
            : null}
        </section>
      );
    },
    DestinationDirectory: (props: ProbeProps) =>
      section('explorer-destinations', props),
    NewRepeatBehavior: (props: ProbeProps) =>
      section('explorer-new-repeat', props),
    MonthlyExplorationChart: (props: ProbeProps) =>
      section('explorer-monthly', props),
    DistanceBandsChart: (props: ProbeProps) =>
      section('explorer-distance-bands', props),
    DestinationRankings: (props: ProbeProps) =>
      section('explorer-rankings', props),
    EvidenceCoverage: (props: ProbeProps) =>
      section('explorer-coverage', props),
    ExplorerMethodology: (props: ProbeProps) =>
      section('explorer-methodology', props),
  };
});

import ExplorerPage from './ExplorerPage';

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: locatedHistory(),
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: 1,
    refetch: refetchMock,
    ...overrides,
  };
}

function drive(id: number, endLat: number, endLon: number): Drive {
  return {
    id,
    vehicleId: 42,
    startTs: `2026-01-0${id}T08:00:00.000Z`,
    endTs: `2026-01-0${id}T08:30:00.000Z`,
    durationS: 1_800,
    distanceM: 10_000,
    startAddress: null,
    endAddress: null,
    startLat: 0,
    startLon: 0,
    endLat,
    endLon,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 2_000,
    regenEnergyWh: null,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
  };
}

function locatedHistory(): Drive[] {
  return [
    drive(1, 0, 0),
    drive(2, 0, 0),
    drive(3, 0, 0),
    drive(4, 1, 0),
  ];
}

const SECTION_IDS = [
  'explorer-kpis',
  'explorer-destinations',
  'explorer-new-repeat',
  'explorer-monthly',
  'explorer-distance-bands',
  'explorer-rankings',
  'explorer-coverage',
  'explorer-methodology',
];

beforeEach(() => {
  vi.clearAllMocks();
  sectionStates.length = 0;
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  historyMock.mockReturnValue(query());
  formatDistanceMock.mockImplementation(
    (value: number) => `display:${value}`,
  );
  unitsMock.mockReturnValue({ formatDistance: formatDistanceMock });
});

describe('ExplorerPage', () => {
  it('mounts the complete workspace, requests 1,000 rows, and shares retry', () => {
    render(<ExplorerPage />);

    expect(
      screen.getByRole('heading', { name: 'Explorer' }),
    ).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(historyMock).toHaveBeenCalledWith('42', 1000);
    expect(pageTitleMock).toHaveBeenCalledWith('Explorer');
    expect(sectionStates).toHaveLength(SECTION_IDS.length);
    expect(sectionStates.every((state) => state === sectionStates[0])).toBe(
      true,
    );

    sectionStates[0]?.onRetry();
    expect(refetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ['loading', query({ isLoading: true })],
    ['error', query({ isError: true, error: new Error('unavailable') })],
    ['empty', query({ data: [] })],
  ])('propagates the %s state to every mounted section', (expected, result) => {
    historyMock.mockReturnValue(result);
    render(<ExplorerPage />);

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent(expected);
    }
  });

  it('keeps meters canonical and formats distance only at render', () => {
    render(<ExplorerPage />);

    const kpis = screen.getByTestId('explorer-kpis');
    expect(kpis).toHaveAttribute('data-model-radius', '111195');
    expect(kpis).toHaveTextContent('display:111195');
    expect(formatDistanceMock).toHaveBeenCalledWith(111195);
  });

  it('preserves no-vehicle recovery while disabling history scope', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    render(<ExplorerPage />);

    expect(screen.getByTestId('no-vehicle')).toHaveTextContent('Explorer');
    expect(historyMock).toHaveBeenCalledWith(undefined, 1000);
    expect(screen.queryByTestId('explorer-monthly')).not.toBeInTheDocument();
  });
});
