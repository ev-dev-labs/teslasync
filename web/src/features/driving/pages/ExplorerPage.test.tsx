import type { ReactNode } from 'react';
import { render as renderUi, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Drive } from '@/types/driving';
import type { ExplorerSummary } from '../lib/explorer';

interface StateProbe {
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

const {
  formatDistanceMock,
  failedSectionMock,
  historyMock,
  pageTitleMock,
  refetchMock,
  sectionStates,
  selectedVehicleMock,
  unitsMock,
} = vi.hoisted(() => ({
  formatDistanceMock: vi.fn(),
  failedSectionMock: vi.fn(),
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

vi.mock('@/hooks/useProductPreferences', () => ({
  useProductPreferences: () => ({ preferences: { defaultAnalysisRange: '7d' } }),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

vi.mock('@/components/layout', () => ({
  PageLayout: ({
    title,
    subtitle,
    actions,
    busy,
    loading,
    error,
    children,
  }: {
    title: string;
    subtitle: string;
    actions: ReactNode;
    busy?: boolean;
    loading?: boolean;
    error?: Error | null;
    children: ReactNode;
  }) => (
    <main aria-busy={busy || undefined}>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {actions}
      {loading || error ? <p>Page content replaced</p> : children}
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
    retained?: boolean;
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
    if (failedSectionMock() === testId) {
      throw new Error('Synthetic section rendering failure');
    }
    sectionStates.push(props.state);
    return <section data-testid={testId}>{status(props)}</section>;
  };

  return {
    ExplorerKpis: (props: ProbeProps) => {
      if (failedSectionMock() === 'explorer-kpis') {
        throw new Error('Synthetic section rendering failure');
      }
      sectionStates.push(props.state);
      const radius = props.summary.radiusM;
      return (
        <section
          data-testid="explorer-kpis"
          data-model-radius={radius ?? undefined}
          data-model-destinations={props.state.isLoading || props.state.error ? undefined : props.summary.uniquePlaces}
          data-retained={props.retained || undefined}
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
      <div
        data-history-limit={props.summary.historyLimit}
        data-cap-reached={props.summary.historyCapReached}
      >
        {section('explorer-methodology', props)}
      </div>,
  };
});

import ExplorerPage from './ExplorerPage';

let route = '/explorer?from=2026-01-01&to=2026-01-07&time_scope=custom';

function render(ui: ReactNode) {
  return renderUi(ui, {
    wrapper: ({ children }) => <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>,
  });
}

function historyWindow() {
  return { start: expect.any(String), end: expect.any(String) };
}

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

beforeAll(async () => {
  await i18n.init({ lng: 'en', fallbackLng: 'en', resources: {} });
});

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  route = '/explorer?from=2026-01-01&to=2026-01-07&time_scope=custom';
  sectionStates.length = 0;
  failedSectionMock.mockReturnValue(null);
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  historyMock.mockReturnValue(query());
  formatDistanceMock.mockImplementation(
    (value: number) => `display:${value}`,
  );
  unitsMock.mockReturnValue({ formatDistance: formatDistanceMock });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ExplorerPage', () => {
  it('passes a rolling 24-hour range without rounding the exclusive upper bound', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T20:15:39.843Z'));
    route = '/explorer?time_scope=24h';
    render(<ExplorerPage />);

    expect(historyMock).toHaveBeenLastCalledWith('42', 1000, {
      start: '2026-10-13T20:15:39.843Z',
      end: '2026-10-14T20:15:39.843Z',
    });
    expect(screen.queryByTestId('vehicle-select')).not.toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it('passes custom non-UTC midnight boundaries across daylight saving time', () => {
    const resolved = Intl.DateTimeFormat().resolvedOptions();
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({ ...resolved, timeZone: 'America/Los_Angeles' });
    route = '/explorer?from=2024-03-09&to=2024-03-10&time_scope=custom';
    render(<ExplorerPage />);

    expect(historyMock).toHaveBeenLastCalledWith('42', 1000, {
      start: '2024-03-09T08:00:00.000Z',
      end: '2024-03-11T07:00:00.000Z',
    });
  });

  it('retains the observed-window cap evidence for a range-scoped result', () => {
    historyMock.mockReturnValue(query({
      data: Array.from({ length: 1000 }, (_, id) => ({ ...drive(1, 0, 0), id: id + 1 })),
    }));
    render(<ExplorerPage />);

    expect(screen.getByTestId('explorer-methodology').parentElement)
      .toHaveAttribute('data-history-limit', '1000');
    expect(screen.getByTestId('explorer-methodology').parentElement)
      .toHaveAttribute('data-cap-reached', 'true');
  });

  it('mounts the complete workspace, requests 1,000 rows, and shares retry', () => {
    render(<ExplorerPage />);

    expect(
      screen.getByRole('heading', { name: 'Explorer' }),
    ).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(historyMock).toHaveBeenCalledWith('42', 1000, historyWindow());
    expect(pageTitleMock).toHaveBeenCalledWith('Explorer');
    expect(sectionStates).toHaveLength(SECTION_IDS.length);
    expect(sectionStates.every((state) => state === sectionStates[0])).toBe(
      true,
    );

    sectionStates[0]?.onRetry();
    expect(refetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ['loading', query({ data: undefined, isLoading: true })],
    ['error', query({ data: undefined, isError: true, error: new Error('unavailable') })],
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
    expect(historyMock).toHaveBeenCalledWith(undefined, 1000, historyWindow());
    expect(screen.queryByTestId('explorer-monthly')).not.toBeInTheDocument();
  });

  it('marks initial work busy without replacing the eight section shells', () => {
    historyMock.mockReturnValue(query({ data: undefined, isLoading: true }));
    const { rerender } = render(<ExplorerPage />);

    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('loading');
    }

    historyMock.mockReturnValue(query());
    rerender(<ExplorerPage />);

    expect(screen.getByRole('main')).not.toHaveAttribute('aria-busy');
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
  });

  it('keeps usable history visible while a background refresh is busy', () => {
    historyMock.mockReturnValue(query({ isFetching: true }));
    render(<ExplorerPage />);

    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(screen.getByTestId('explorer-kpis')).toHaveTextContent('display:111195');
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it('keeps paused initial history unknown, offers retry, and resumes loading before recovery', async () => {
    const user = userEvent.setup();
    historyMock.mockReturnValue(query({
      data: undefined,
      isPending: true,
      isLoading: false,
      fetchStatus: 'paused',
    }));
    const { rerender } = render(<ExplorerPage />);

    expect(screen.getByRole('main')).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('status')).toHaveAttribute('data-refresh-blocked');
    expect(screen.getByRole('status')).toHaveTextContent('Refresh paused');
    expect(screen.getByRole('status')).not.toHaveTextContent(/offline|failed|error/i);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('loading');
      expect(screen.getByTestId(id)).not.toHaveTextContent('empty');
    }
    expect(sectionStates.every((state) => state.error == null)).toBe(true);
    expect(screen.getByTestId('explorer-kpis')).not.toHaveAttribute('data-model-destinations');
    expect(screen.getByTestId('explorer-kpis')).not.toHaveAttribute('data-model-radius');
    expect(formatDistanceMock).not.toHaveBeenCalled();
    expect(refetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetchMock).toHaveBeenCalledOnce();

    historyMock.mockReturnValue(query({
      data: undefined,
      isPending: true,
      isLoading: true,
      isFetching: true,
      fetchStatus: 'fetching',
    }));
    rerender(<ExplorerPage />);

    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('loading');
    }

    historyMock.mockReturnValue(query());
    rerender(<ExplorerPage />);

    expect(screen.getByRole('main')).not.toHaveAttribute('aria-busy');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(screen.getByTestId('explorer-kpis')).toHaveTextContent('display:111195');
  });

  it('preserves a successful zero destination count as measured data', () => {
    historyMock.mockReturnValue(query({
      data: [drive(1, 0, 0), drive(2, 0, 0), drive(3, 0, 0)],
    }));
    render(<ExplorerPage />);

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(screen.getByTestId('explorer-kpis')).toHaveAttribute('data-model-destinations', '0');
    expect(screen.getByTestId('explorer-kpis')).not.toHaveAttribute('data-model-radius');
    expect(formatDistanceMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('retains historical readings on refresh failure and exposes source retry', async () => {
    const user = userEvent.setup();
    historyMock.mockReturnValue(query({
      isError: true,
      error: new Error('Synthetic history refresh failure'),
    }));
    const { rerender } = render(<ExplorerPage />);

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(screen.getByTestId('explorer-kpis')).toHaveAttribute('data-retained', 'true');
    expect(screen.getByTestId('explorer-kpis')).toHaveTextContent('display:111195');
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent(
      'Previously loaded data remains visible while affected sources recover.',
    );
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetchMock).toHaveBeenCalledOnce();

    historyMock.mockReturnValue(query());
    rerender(<ExplorerPage />);

    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByTestId('explorer-kpis')).not.toHaveAttribute('data-retained');
    expect(screen.getByTestId('explorer-kpis')).toHaveTextContent('display:111195');
  });

  it('keeps paused history retained without inventing an offline failure', () => {
    historyMock.mockReturnValue(query({ fetchStatus: 'paused' }));
    render(<ExplorerPage />);

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(screen.getByTestId('explorer-kpis')).toHaveAttribute('data-retained', 'true');
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute(
      'data-refresh-blocked', 'true',
    );
    expect(screen.getByTestId('stale-refresh-warning')).not.toHaveTextContent(/offline/i);
    expect(screen.getByRole('main')).not.toHaveAttribute('aria-busy');
    expect(refetchMock).not.toHaveBeenCalled();
  });

  it('preserves an authoritatively empty retained window after refresh failure', () => {
    historyMock.mockReturnValue(query({
      data: [],
      isError: true,
      error: new Error('Synthetic empty-window refresh failure'),
    }));
    render(<ExplorerPage />);

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('empty');
    }
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByTestId('explorer-kpis')).not.toHaveAttribute('data-model-radius');
    expect(formatDistanceMock).not.toHaveBeenCalled();
  });

  it('switches workspace vehicle scope without carrying another vehicle radius', () => {
    const { rerender } = render(<ExplorerPage />);
    expect(screen.getByTestId('explorer-kpis')).toHaveAttribute(
      'data-model-radius', '111195',
    );

    selectedVehicleMock.mockReturnValue({ vehicleId: 7 });
    historyMock.mockReturnValue(query({ data: undefined, isLoading: true }));
    rerender(<ExplorerPage />);

    expect(historyMock).toHaveBeenLastCalledWith('7', 1000, historyWindow());
    expect(screen.getByTestId('explorer-kpis')).not.toHaveAttribute('data-model-radius');
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('loading');
    }
    expect(screen.queryByTestId('vehicle-select')).not.toBeInTheDocument();
  });

  it.each(SECTION_IDS)(
    'isolates and retries rendering failure in %s without erasing neighboring sections',
    async (failedId) => {
      const user = userEvent.setup();
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        failedSectionMock.mockReturnValue(failedId);
        render(<ExplorerPage />);

        expect(screen.getByRole('heading', { name: 'Explorer' })).toBeInTheDocument();
        expect(screen.queryByTestId(failedId)).not.toBeInTheDocument();
        for (const id of SECTION_IDS.filter((id) => id !== failedId)) {
          expect(screen.getByTestId(id)).toHaveTextContent('ready');
        }
        expect(screen.getByText('Component failed to load')).toBeInTheDocument();

        failedSectionMock.mockReturnValue(null);
        await user.click(screen.getByRole('button', { name: 'Retry' }));

        for (const id of SECTION_IDS) {
          expect(screen.getByTestId(id)).toHaveTextContent('ready');
        }
        expect(screen.queryByText('Component failed to load')).not.toBeInTheDocument();
        expect(refetchMock).not.toHaveBeenCalled();
      } finally {
        errorLog.mockRestore();
      }
    },
  );
});
