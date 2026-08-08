import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Drive } from '@/types/driving';

const {
  pageTitleMock,
  selectedVehicleMock,
  unitsMock,
  useDrivesMock,
} = vi.hoisted(() => ({
  pageTitleMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  unitsMock: vi.fn(),
  useDrivesMock: vi.fn(),
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
  useDrives: (...args: unknown[]) => useDrivesMock(...args),
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

vi.mock('@/hooks/useRangeState', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    useRangeState: () => {
      const [range, setRange] = React.useState({
        start: '2025-01-01',
        end: '2026-08-07',
      });
      return { ...range, setRange };
    },
  };
});

vi.mock('@/components/forms', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    VehicleSelect: () =>
      React.createElement('div', { 'data-testid': 'vehicle-select' }),
    RangePicker: (props: {
      value: { start: string; end: string };
      onChange: (range: { start: string; end: string }) => void;
      triggerTestId?: string;
    }) =>
      React.createElement(
        'button',
        {
          type: 'button',
          'data-testid': props.triggerTestId,
          'data-range': `${props.value.start}:${props.value.end}`,
          onClick: () =>
            props.onChange({ start: '2026-07-01', end: '2026-07-31' }),
        },
        'range',
      ),
  };
});

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

vi.mock('@/components/feedback', async () => {
  const actual = await vi.importActual<typeof import('@/components/feedback')>(
    '@/components/feedback',
  );
  return {
    ...actual,
    QueryError: ({ error }: { error: unknown }) => (
      <div role="alert">{String(error)}</div>
    ),
  };
});

vi.mock('@/features/onboarding/components/NoVehicleSelected', () => ({
  NoVehicleSelected: ({ pageTitle }: { pageTitle: string }) => (
    <div data-testid="no-vehicle">{pageTitle}</div>
  ),
}));

vi.mock('../components/speed-sweet-spot', async () => {
  const actual = await vi.importActual<
    typeof import('../components/speed-sweet-spot/SpeedSweetSpotKpis')
  >('../components/speed-sweet-spot/SpeedSweetSpotKpis');
  type State = { isLoading: boolean; error: unknown };
  type SummaryProbe = {
    sweetSpot: { fromKph: number; whPerKm: number } | null;
  };
  const status = (state: State) =>
    state.error ? 'error' : state.isLoading ? 'loading' : 'ready';
  const section = (
    testId: string,
    state: State,
    summary?: SummaryProbe,
  ) => (
    <section
      data-testid={testId}
      data-model-from={summary?.sweetSpot?.fromKph}
      data-model-wh={summary?.sweetSpot?.whPerKm}
    >
      {status(state)}
    </section>
  );
  const ActualKpis = actual.SpeedSweetSpotKpis;

  return {
    SpeedSweetSpotKpis: (props: Parameters<typeof ActualKpis>[0]) => (
      <div data-testid="speed-sweet-spot-kpi-state" data-state={status(props)}>
        <ActualKpis {...props} />
      </div>
    ),
    SweetSpotEvidence: (props: {
      state: State;
      summary: SummaryProbe;
    }) => section('speed-sweet-spot-evidence', props.state, props.summary),
    SpeedBandCoverage: (props: { state: State }) =>
      section('speed-sweet-spot-coverage', props.state),
    ConsumptionSpeedCurve: (props: { state: State }) =>
      section('speed-sweet-spot-curve', props.state),
    DriveEvidenceScatter: (props: { state: State }) =>
      section('speed-sweet-spot-scatter', props.state),
    MonthlyOperatingContext: (props: { state: State }) =>
      section('speed-sweet-spot-monthly', props.state),
    SpeedBandScorecard: (props: { state: State }) =>
      section('speed-sweet-spot-scorecard', props.state),
    SpeedSweetSpotMethodology: (props: { state: State }) =>
      section('speed-sweet-spot-method', props.state),
  };
});

import SpeedSweetSpotPage from './SpeedSweetSpotPage';

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
    ...overrides,
  };
}

function drive(id: number): Drive {
  return {
    id,
    vehicleId: 42,
    startTs: `2026-07-0${id}T08:00:00Z`,
    endTs: null,
    durationS: 600,
    distanceM: 10_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 1_500,
    regenEnergyWh: null,
    avgSpeedMps: 100 / 3.6,
    maxSpeedMps: null,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
  };
}

const SECTION_IDS = [
  'speed-sweet-spot-kpis',
  'speed-sweet-spot-evidence',
  'speed-sweet-spot-coverage',
  'speed-sweet-spot-curve',
  'speed-sweet-spot-scatter',
  'speed-sweet-spot-monthly',
  'speed-sweet-spot-scorecard',
  'speed-sweet-spot-method',
];

beforeEach(() => {
  vi.clearAllMocks();
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  useDrivesMock.mockReturnValue(query());
  unitsMock.mockReturnValue({
    unitPrefs: {
      distance: 'km',
      speed: 'km/h',
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
    },
  });
});

describe('SpeedSweetSpotPage', () => {
  it('mounts every workspace section and requests the selected server window', () => {
    render(<SpeedSweetSpotPage />);

    expect(
      screen.getByRole('heading', { name: 'Speed Sweet Spot' }),
    ).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(useDrivesMock).toHaveBeenCalledWith('42', {
      start: '2025-01-01',
      end: '2026-08-07',
      limit: 1000,
    });
    expect(pageTitleMock).toHaveBeenCalledWith('Speed Sweet Spot');
  });

  it('re-queries when the selected range changes', async () => {
    render(<SpeedSweetSpotPage />);
    fireEvent.click(screen.getByTestId('speed-sweetspot-range'));

    await waitFor(() =>
      expect(useDrivesMock).toHaveBeenLastCalledWith('42', {
        start: '2026-07-01',
        end: '2026-07-31',
        limit: 1000,
      }),
    );
  });

  it.each([
    ['loading', query({ isLoading: true })],
    ['error', query({ isError: true, error: new Error('unavailable') })],
  ])('propagates the %s state to every mounted section', (expected, result) => {
    useDrivesMock.mockReturnValue(result);
    render(<SpeedSweetSpotPage />);

    expect(screen.getByTestId('speed-sweet-spot-kpi-state')).toHaveAttribute(
      'data-state',
      expected,
    );
    for (const id of SECTION_IDS.slice(1)) {
      expect(screen.getByTestId(id)).toHaveTextContent(expected);
    }
  });

  it('preserves no-vehicle recovery while disabling the drives query', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    render(<SpeedSweetSpotPage />);

    expect(screen.getByTestId('no-vehicle')).toHaveTextContent(
      'Speed Sweet Spot',
    );
    expect(useDrivesMock).toHaveBeenCalledWith(undefined, {
      start: '2025-01-01',
      end: '2026-08-07',
      limit: 1000,
    });
    expect(
      screen.queryByTestId('speed-sweet-spot-curve'),
    ).not.toBeInTheDocument();
  });

  it('converts to miles only at render while preserving SI model values', () => {
    unitsMock.mockReturnValue({
      unitPrefs: {
        distance: 'mi',
        speed: 'mph',
        temperature: '°F',
        pressure: 'psi',
        energy: 'kWh',
        duration: 'h',
        power: 'kW',
        locale: 'en-US',
      },
    });
    useDrivesMock.mockReturnValue(query({ data: [drive(1), drive(2), drive(3)] }));
    render(<SpeedSweetSpotPage />);

    expect(screen.getByText('62–68 mph')).toBeInTheDocument();
    expect(screen.getAllByText('241 Wh/mi')).toHaveLength(2);
    expect(screen.getByTestId('speed-sweet-spot-evidence')).toHaveAttribute(
      'data-model-from',
      '100',
    );
    expect(screen.getByTestId('speed-sweet-spot-evidence')).toHaveAttribute(
      'data-model-wh',
      '150',
    );
  });

  it('renders the same SI-derived model in metric display units', () => {
    useDrivesMock.mockReturnValue(query({ data: [drive(1), drive(2), drive(3)] }));
    render(<SpeedSweetSpotPage />);

    expect(screen.getByText('100–110 km/h')).toBeInTheDocument();
    expect(screen.getAllByText('150 Wh/km')).toHaveLength(2);
  });
});
