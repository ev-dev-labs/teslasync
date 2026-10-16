import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { Drive } from '@/types/driving';

const {
  useDrivesMock,
  selectedVehicleMock,
  pageTitleMock,
  summarizeParkingMock,
  sharedRange,
  datePreferences,
} = vi.hoisted(() => ({
  useDrivesMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  pageTitleMock: vi.fn(),
  summarizeParkingMock: vi.fn(),
  sharedRange: {
    set: (_range: { start: string; end: string }) => {},
    rolling: { active: false, startInstant: '', endInstantExclusive: '', timezone: '' },
  },
  datePreferences: { tz: 'America/Los_Angeles', locale: 'de-DE' },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) =>
          text.replace(new RegExp(`{{${name}}}`, 'g'), String(value)),
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

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    ...datePreferences,
    formatDateTime: (value: Date) => new Intl.DateTimeFormat(datePreferences.locale, {
      timeZone: datePreferences.tz, dateStyle: 'short', timeStyle: 'short',
    }).format(value),
  }),
}));

vi.mock('@/hooks/useRangeState', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const { calendarRangeToInstants } = await vi.importActual<typeof import('@/lib/dateRange')>('@/lib/dateRange');
  return {
    useRangeState: (options: { timezone: string }) => {
      const [range, setRange] = React.useState({
        start: '2026-07-01',
        end: '2026-08-07',
      });
      sharedRange.set = setRange;
      return {
        ...range,
        ...(sharedRange.rolling.active ? sharedRange.rolling : calendarRangeToInstants({
          startDate: range.start, endDate: range.end, timezone: options.timezone,
        })),
        timezone: sharedRange.rolling.active ? sharedRange.rolling.timezone : options.timezone,
        setRange,
      };
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
            props.onChange({ start: '2026-07-10', end: '2026-07-31' }),
        },
        'range',
      ),
  };
});

vi.mock('@/components/layout', () => ({
  PageLayout: ({
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

vi.mock('@/components/motion', async () => {
  const actual = await vi.importActual<typeof import('@/components/motion')>(
    '@/components/motion',
  );
  return {
    ...actual,
    FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/features/onboarding/components/NoVehicleSelected', () => ({
  NoVehicleSelected: ({ pageTitle }: { pageTitle: string }) => (
    <div data-testid="no-vehicle">{pageTitle}</div>
  ),
}));

vi.mock('../components/parking-analytics', () => {
  interface State {
    isLoading: boolean;
    error: unknown;
  }
  const status = (state: State) =>
    state.isLoading ? 'loading' : state.error ? 'error' : 'ready';
  const section = (testId: string, state: State) => (
    <section data-testid={testId}>{status(state)}</section>
  );
  return {
    ParkingKpiBand: (props: State) => section('parking-kpis', props),
    DurationDistributionChart: (props: { state: State }) =>
      section('parking-duration', props.state),
    ParkingTemporalProfile: (props: { state: State }) =>
      section('parking-temporal', props.state),
    MonthlyDwellTrend: (props: { state: State }) =>
      section('parking-monthly', props.state),
    TopParkingLocations: (props: { state: State }) =>
      section('parking-locations', props.state),
    LongestParkingStints: (props: { state: State }) =>
      section('parking-longest', props.state),
    OvernightParkingContext: (props: { state: State }) =>
      section('parking-overnight', props.state),
    ParkingCoverageMethodology: (props: { state: State; hasSource: boolean; sourceStatus: string }) => (
      <section data-testid="parking-coverage" data-has-source={String(props.hasSource)}
        data-source-status={props.sourceStatus}>{status(props.state)}</section>
    ),
  };
});

vi.mock('../lib/parkingDwell', async () => {
  const actual = await vi.importActual<
    typeof import('../lib/parkingDwell')
  >('../lib/parkingDwell');
  summarizeParkingMock.mockImplementation(actual.summarizeParking);
  return {
    ...actual,
    summarizeParking: summarizeParkingMock,
  };
});

import { parseParkingInstantRange, type SummarizeParkingOptions } from '../lib/parkingDwell';
import { ParkingMethodCaveats } from '../components/parking-analytics/ParkingMethodCaveats';
import ParkingAnalyticsPage from './ParkingAnalyticsPage';

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: [] as Drive[],
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function sampleDrives(count: number): Drive[] {
  return Array.from({ length: count }, (_, index) => {
    const startMs = Date.parse('2026-07-01T00:00:00.000Z') + index * 60_000;
    return {
      id: index + 1,
      vehicleId: 42,
      startTs: new Date(startMs).toISOString(),
      endTs: new Date(startMs + 30_000).toISOString(),
      durationS: 30,
      distanceM: 0,
      startAddress: null,
      endAddress: null,
      startLat: null,
      startLon: null,
      endLat: null,
      endLon: null,
      startBatteryPct: null,
      endBatteryPct: null,
      energyUsedWh: null,
      regenEnergyWh: null,
      avgSpeedMps: null,
      maxSpeedMps: null,
      avgPowerW: null,
      outsideTempAvgC: null,
      insideTempAvgC: null,
      score: null,
      endedStatus: null,
      createdAt: '',
      updatedAt: '',
    };
  });
}

const SECTION_IDS = [
  'parking-kpis',
  'parking-duration',
  'parking-temporal',
  'parking-monthly',
  'parking-locations',
  'parking-longest',
  'parking-overnight',
  'parking-coverage',
];

beforeEach(() => {
  vi.clearAllMocks();
  datePreferences.tz = 'America/Los_Angeles';
  datePreferences.locale = 'de-DE';
  sharedRange.rolling.active = false;
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  useDrivesMock.mockReturnValue(query());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ParkingAnalyticsPage', () => {
  it.each([
    { case: 'below cap', count: 999, status: 'Source returned' },
    { case: 'at cap', count: 1_000, status: 'Partial source coverage' },
  ])('discloses successful sample coverage $case without changing SI records', ({ count, status }) => {
    const drives = sampleDrives(count);
    useDrivesMock.mockReturnValue(query({ data: drives }));
    render(<ParkingAnalyticsPage />, { wrapper: MemoryRouter });

    const brief = screen.getByTestId('parking-summary');
    expect(brief).toHaveTextContent(status);
    if (count === 1_000) {
      expect(brief).not.toHaveTextContent('Source returned');
    }
    expect(summarizeParkingMock.mock.calls[0][0]).toBe(drives);
    expect(drives[0]).toMatchObject({
      durationS: 30,
      distanceM: 0,
      energyUsedWh: null,
      endAddress: null,
    });
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
      if (id !== 'parking-kpis') {
        expect(screen.getByTestId(id)).toHaveTextContent('ready');
      }
    }
    expect(useDrivesMock).toHaveBeenCalledWith('42', {
      start: '2026-07-01T07:00:00.000Z',
      end: '2026-08-08T07:00:00.000Z',
      limit: 1_000,
    });
  });

  it('retains the refresh-failure status and retry for a capped sample', () => {
    const refetch = vi.fn();
    const drives = sampleDrives(1_000);
    useDrivesMock.mockReturnValue(query({
      data: drives,
      isError: true,
      error: new Error('refresh failed'),
      refetch,
    }));
    render(<ParkingAnalyticsPage />, { wrapper: MemoryRouter });

    const brief = screen.getByTestId('parking-summary');
    assertOperationalBriefDisclosure(brief, 'Retained source', { contains: true });
    expect(brief).not.toHaveTextContent('Partial source coverage');
    const warning = screen.getByTestId('stale-refresh-warning');
    fireEvent.click(within(warning).getByRole('button'));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(summarizeParkingMock.mock.calls[0][0]).toBe(drives);
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
      if (id !== 'parking-kpis') {
        expect(screen.getByTestId(id)).toHaveTextContent('ready');
      }
    }
  });

  it('mounts all eight sections and requests the selected server window', () => {
    render(<ParkingAnalyticsPage />, { wrapper: MemoryRouter });

    expect(
      screen.getByRole('heading', { name: 'Parking analytics' }),
    ).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      if (id === 'parking-kpis') expect(screen.getByTestId(id)).toHaveTextContent('Source returned');
      else expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(useDrivesMock).toHaveBeenCalledWith('42', {
      start: '2026-07-01T07:00:00.000Z',
      end: '2026-08-08T07:00:00.000Z',
      limit: 1_000,
    });
  });

  it('passes newly selected dates and the 1,000-row cap to the hook', async () => {
    render(<ParkingAnalyticsPage />, { wrapper: MemoryRouter });
    act(() => sharedRange.set({ start: '2026-07-10', end: '2026-07-31' }));
    expect(screen.queryByTestId('parking-analytics-range')).not.toBeInTheDocument();

    await waitFor(() =>
      expect(useDrivesMock).toHaveBeenLastCalledWith('42', {
        start: '2026-07-10T07:00:00.000Z',
        end: '2026-08-01T07:00:00.000Z',
        limit: 1_000,
      }),
    );
  });

  it.each([
    ['loading', query({ data: undefined, isLoading: true, isPending: true, isFetching: true, fetchStatus: 'fetching' })],
    ['error', query({ data: undefined, isError: true, error: new Error('unavailable') })],
  ])('threads the %s state to every mounted section', (expected, result) => {
    useDrivesMock.mockReturnValue(result);
    render(<ParkingAnalyticsPage />, { wrapper: MemoryRouter });

    for (const id of SECTION_IDS) {
      if (id === 'parking-kpis') {
        if (expected === 'loading') expect(screen.getByTestId('parking-summary')).toHaveAttribute('aria-busy', 'true');
        else expect(screen.getByTestId(id)).toHaveTextContent('Source unavailable');
      } else expect(screen.getByTestId(id)).toHaveTextContent(expected);
    }
  });

  it.each([
    ['idle', false],
    ['paused', false],
    ['fetching', true],
  ])('keeps an unresolved %s source pending rather than empty', (fetchStatus, busy) => {
    useDrivesMock.mockReturnValue(query({
      data: undefined, isPending: true, fetchStatus,
      isFetching: busy, isLoading: busy,
    }));
    const { rerender } = render(<ParkingAnalyticsPage />, { wrapper: MemoryRouter });

    const brief = screen.getByTestId('parking-summary');
    expect(screen.getByTestId('parking-coverage')).toHaveAttribute('data-has-source', 'false');
    expect(screen.getByTestId('parking-coverage')).toHaveAttribute('data-source-status', 'initial');
    // aria-busy is only present while busy.
    if (busy) expect(brief).toHaveAttribute('aria-busy', 'true');
    else expect(brief).not.toHaveAttribute('aria-busy');
    expect(brief).toHaveTextContent(busy ? 'Loading source' : 'Pending');
    expect(screen.queryByText('Not enough drives in this period to reconstruct parking.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    if (fetchStatus === 'paused') {
      expect(screen.getAllByText('Refresh paused').length).toBeGreaterThan(0);
      expect(screen.getByText('This source has not resolved yet; missing evidence is not a confirmed empty result.')).toBeInTheDocument();
      expect(screen.queryByText(/offline|refresh failed|Source unavailable/i)).not.toBeInTheDocument();
    }
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
      if (id !== 'parking-kpis') expect(screen.getByTestId(id)).toHaveTextContent('loading');
    }
    const locations = brief.querySelector('[data-operational-metric="locations"]');
    expect(locations).toHaveAttribute('data-value-state', 'missing');

    useDrivesMock.mockReturnValue(query({ isSuccess: true }));
    rerender(<ParkingAnalyticsPage />);
    expect(screen.getByText('Not enough drives in this period to reconstruct parking.')).toBeInTheDocument();
    expect(screen.getByTestId('parking-summary')).toHaveTextContent('Source returned');
    expect(screen.getByTestId('parking-coverage')).toHaveAttribute('data-has-source', 'true');
    expect(screen.getByTestId('parking-coverage')).toHaveAttribute('data-source-status', 'ok');
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
    for (const id of SECTION_IDS.filter(id => id !== 'parking-kpis')) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
  });

  it('keeps populated parking evidence visible when refresh is paused without claiming failure', () => {
    const drives = sampleDrives(1_000);
    useDrivesMock.mockReturnValue(query({ data: drives, fetchStatus: 'paused' }));
    render(<ParkingAnalyticsPage />, { wrapper: MemoryRouter });

    expect(screen.getByTestId('parking-summary')).toHaveTextContent('Refresh paused');
    expect(screen.getByTestId('parking-summary')).not.toHaveAttribute('aria-busy');
    const warning = screen.getByTestId('stale-refresh-warning');
    expect(warning).toHaveAttribute('data-refresh-blocked', 'true');
    expect(warning).toHaveTextContent('Refresh paused');
    expect(warning).not.toHaveTextContent(/offline|failed|error/i);
    expect(summarizeParkingMock.mock.calls[0][0]).toBe(drives);
    for (const id of SECTION_IDS.filter(id => id !== 'parking-kpis')) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
  });

  it('keeps the accepted snapshot clock across range-driven render cycles', async () => {
    const frozenNow = Date.parse('2026-08-07T20:00:00.000Z');
    const laterNow = frozenNow + 6 * 3_600_000;
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(frozenNow)
      .mockReturnValue(laterNow);
    useDrivesMock.mockReturnValue(query({ dataUpdatedAt: frozenNow }));

    render(<ParkingAnalyticsPage />, { wrapper: MemoryRouter });
    act(() => sharedRange.set({ start: '2026-07-10', end: '2026-07-31' }));
    await waitFor(() => expect(summarizeParkingMock).toHaveBeenCalledTimes(2));

    const modelOptions = summarizeParkingMock.mock.calls.map(
      (call) => call[1] as SummarizeParkingOptions,
    );
    expect(modelOptions.map((model) => model.nowMs)).toEqual([
      frozenNow,
      frozenNow,
    ]);
    expect(modelOptions[1]).toMatchObject({
      startInstant: '2026-07-10T07:00:00.000Z',
      endInstantExclusive: '2026-08-01T07:00:00.000Z',
      timeZone: 'America/Los_Angeles',
      rowLimit: 1_000,
    });
  });

  it('accepts newer drives after a successful refresh and retains that edge through failed or paused refreshes', () => {
    const firstNow = Date.parse('2026-08-07T20:00:00.000Z');
    const acceptedNow = firstNow + 3_600_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(firstNow);
    const drives = [{
      ...sampleDrives(1)[0],
      startTs: '2026-08-07T18:00:00.000Z',
      endTs: '2026-08-07T19:00:00.000Z',
    }];
    useDrivesMock.mockReturnValue(query({ data: drives, dataUpdatedAt: firstNow }));
    const { rerender } = render(<ParkingAnalyticsPage />, { wrapper: MemoryRouter });
    expect(summarizeParkingMock.mock.results.at(-1)?.value.totalParkedMs).toBe(3_600_000);

    clock.mockReturnValue(acceptedNow);
    const refreshedDrives = [...drives, {
      ...sampleDrives(1)[0], id: 2,
      startTs: '2026-08-07T20:15:00.000Z',
      endTs: '2026-08-07T20:30:00.000Z',
    }];
    useDrivesMock.mockReturnValue(query({ data: refreshedDrives, dataUpdatedAt: acceptedNow }));
    rerender(<ParkingAnalyticsPage />);
    const refreshedSummary = summarizeParkingMock.mock.results.at(-1)?.value;
    expect(summarizeParkingMock.mock.calls.at(-1)?.[1].nowMs).toBe(acceptedNow);
    expect(refreshedSummary.coverage).toMatchObject({
      validDrives: 2, futureStart: 0, futureEnd: 0, observationEndMs: acceptedNow,
    });
    expect(refreshedSummary.stints.map((stint: { sourceDriveId: number }) => stint.sourceDriveId)).toEqual([1, 2]);
    expect(refreshedSummary.totalParkedMs).toBe(105 * 60_000);

    clock.mockReturnValue(acceptedNow + 6 * 3_600_000);
    for (const state of [
      { isError: true, error: new Error('refresh failed') },
      { fetchStatus: 'paused' },
      { isFetching: true, fetchStatus: 'fetching' },
    ]) {
      useDrivesMock.mockReturnValue(query({
        data: refreshedDrives, dataUpdatedAt: acceptedNow, ...state,
      }));
      rerender(<ParkingAnalyticsPage />);
      expect(summarizeParkingMock.mock.results.at(-1)?.value).toBe(refreshedSummary);
      expect(summarizeParkingMock.mock.calls.at(-1)?.[1].nowMs).toBe(acceptedNow);
      for (const id of SECTION_IDS.filter(id => id !== 'parking-kpis')) {
        expect(screen.getByTestId(id)).toHaveTextContent('ready');
      }
    }
  });

  it('uses each selected vehicle cache snapshot acceptance time instead of the mount clock', () => {
    const firstNow = Date.parse('2026-08-07T20:00:00.000Z');
    vi.spyOn(Date, 'now').mockReturnValue(firstNow);
    useDrivesMock.mockReturnValue(query({ data: sampleDrives(2), dataUpdatedAt: firstNow }));
    const { rerender } = render(<ParkingAnalyticsPage />, { wrapper: MemoryRouter });

    const cachedNow = firstNow + 3_600_000;
    selectedVehicleMock.mockReturnValue({ vehicleId: 99 });
    const drives = [{
      ...sampleDrives(1)[0], vehicleId: 99,
      startTs: '2026-08-07T20:15:00.000Z',
      endTs: '2026-08-07T20:30:00.000Z',
    }];
    useDrivesMock.mockReturnValue(query({ data: drives, dataUpdatedAt: cachedNow }));
    rerender(<ParkingAnalyticsPage />);
    expect(useDrivesMock.mock.calls.at(-1)?.[0]).toBe('99');
    expect(summarizeParkingMock.mock.calls.at(-1)?.[1].nowMs).toBe(cachedNow);
    expect(summarizeParkingMock.mock.results.at(-1)?.value).toMatchObject({
      totalParkedMs: 30 * 60_000, coverage: { validDrives: 1, futureStart: 0 },
    });
  });

  it('advances the trailing edge when an unchanged drive array is accepted again', () => {
    const firstNow = Date.parse('2026-08-07T20:00:00.000Z');
    vi.spyOn(Date, 'now').mockReturnValue(firstNow + 6 * 3_600_000);
    const drives = [{
      ...sampleDrives(1)[0],
      startTs: '2026-08-07T18:00:00.000Z',
      endTs: '2026-08-07T19:00:00.000Z',
    }];
    useDrivesMock.mockReturnValue(query({ data: drives, dataUpdatedAt: firstNow }));
    const { rerender } = render(<ParkingAnalyticsPage />, { wrapper: MemoryRouter });
    expect(summarizeParkingMock.mock.results.at(-1)?.value.totalParkedMs).toBe(3_600_000);

    useDrivesMock.mockReturnValue(query({ data: drives, dataUpdatedAt: firstNow + 3_600_000 }));
    rerender(<ParkingAnalyticsPage />);
    expect(summarizeParkingMock.mock.calls.at(-1)?.[0]).toBe(drives);
    expect(summarizeParkingMock.mock.calls.at(-1)?.[1].nowMs).toBe(firstNow + 3_600_000);
    expect(summarizeParkingMock.mock.results.at(-1)?.value.totalParkedMs).toBe(2 * 3_600_000);
  });

  it.each([0, undefined, NaN])('renews a deterministic fallback clock only for a new snapshot or scope (timestamp %s)', (dataUpdatedAt) => {
    const firstNow = Date.parse('2026-08-07T20:00:00.000Z');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(firstNow);
    const drives = sampleDrives(2);
    useDrivesMock.mockReturnValue(query({ data: drives, dataUpdatedAt }));
    const { rerender } = render(<ParkingAnalyticsPage />, { wrapper: MemoryRouter });
    expect(summarizeParkingMock.mock.calls.at(-1)?.[1].nowMs).toBe(firstNow);

    const laterNow = firstNow + 3_600_000;
    clock.mockReturnValue(laterNow);
    useDrivesMock.mockReturnValue(query({ data: drives, dataUpdatedAt, fetchStatus: 'paused' }));
    rerender(<ParkingAnalyticsPage />);
    expect(summarizeParkingMock.mock.calls.at(-1)?.[1].nowMs).toBe(firstNow);

    act(() => sharedRange.set({ start: '2026-07-10', end: '2026-07-31' }));
    expect(summarizeParkingMock.mock.calls.at(-1)?.[1].nowMs).toBe(laterNow);
    clock.mockReturnValue(laterNow + 3_600_000);
    selectedVehicleMock.mockReturnValue({ vehicleId: 99 });
    rerender(<ParkingAnalyticsPage />);
    expect(summarizeParkingMock.mock.calls.at(-1)?.[1].nowMs).toBe(laterNow + 3_600_000);

    clock.mockReturnValue(laterNow + 2 * 3_600_000);
    useDrivesMock.mockReturnValue(query({ data: [...drives], dataUpdatedAt }));
    rerender(<ParkingAnalyticsPage />);
    expect(summarizeParkingMock.mock.calls.at(-1)?.[1].nowMs).toBe(laterNow + 2 * 3_600_000);
  });

  it('preserves the no-vehicle selection state', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    render(<ParkingAnalyticsPage />, { wrapper: MemoryRouter });

    expect(screen.getByTestId('no-vehicle')).toHaveTextContent(
      'Parking analytics',
    );
    expect(screen.queryByTestId('parking-duration')).not.toBeInTheDocument();
  });

  it('keeps every section available on a failed cached refresh without changing range bounds', () => {
    useDrivesMock.mockReturnValue(query({ data: [], isError: true, error: new Error('refresh failed') }));
    render(<ParkingAnalyticsPage />, { wrapper: MemoryRouter });
    for (const id of SECTION_IDS) {
      if (id === 'parking-kpis') expect(screen.getByTestId(id)).toHaveTextContent('Retained source');
      else expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(useDrivesMock).toHaveBeenCalledWith('42', { start: '2026-07-01T07:00:00.000Z', end: '2026-08-08T07:00:00.000Z', limit: 1_000 });
  });

  it('preserves observed sample context in the actual review drawer and distinguishes unavailable counts from zero', () => {
    useDrivesMock.mockReturnValue(query({ data: undefined, isError: true, error: new Error('unavailable') }));
    render(<ParkingAnalyticsPage />, { wrapper: MemoryRouter });
    const brief = screen.getByTestId('parking-summary');
    const locations = brief.querySelector('[data-operational-metric="locations"]');
    if (!(locations instanceof HTMLElement)) throw new Error('Locations evidence missing');
    expect(locations).toHaveAttribute('data-value-state', 'missing');
    expect(within(locations).queryByText('0')).not.toBeInTheDocument();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText(/22:00–06:00/)).toBeInTheDocument();
    expect(within(drawer).getByText(/0 located · 0 missing/)).toBeInTheDocument();
  });

  it.each([
    ['America/Los_Angeles', '2026-03-08', '2026-03-08T08:00:00.000Z', '2026-03-09T07:00:00.000Z', 23],
    ['Europe/Berlin', '2026-10-25', '2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z', 25],
    ['Asia/Kolkata', '2026-07-01', '2026-06-30T18:30:00.000Z', '2026-07-01T18:30:00.000Z', 24],
  ])('shares exact local-day boundaries with the model in %s', (timezone, day, start, end, hours) => {
    datePreferences.tz = timezone;
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2027-01-01T00:00:00Z'));
    const drives = [startMs - 1, startMs, endMs - 1, endMs].map((instant, index) => ({
      ...sampleDrives(1)[0], id: index + 1,
      startTs: new Date(instant).toISOString(),
      endTs: new Date(instant).toISOString(),
    }));
    useDrivesMock.mockReturnValue(query({ data: drives }));
    render(<ParkingAnalyticsPage />, { wrapper: MemoryRouter });
    act(() => sharedRange.set({ start: day, end: day }));

    expect(useDrivesMock).toHaveBeenLastCalledWith('42', { start, end, limit: 1_000 });
    const result = summarizeParkingMock.mock.results.at(-1)?.value;
    expect(result.coverage).toMatchObject({
      invalidRange: false, rangeStartMs: startMs, rangeEndExclusiveMs: endMs,
      validDrives: 2, outsideWindow: 2, timeZone: timezone,
    });
    expect(result.totalParkedMs).toBe(hours * 3_600_000);
    expect(result.stints.at(-1).endMs).toBe(endMs);
    expect(result.hourly[0].stints).toBe(1);
    expect(screen.getByTestId('parking-summary')).toHaveTextContent(timezone);
  });

  it.each([
    ['', '2026-07-02T00:00:00Z'],
    ['2026-07-01T00:00:00Z', ''],
    ['not-a-date', '2026-07-02T00:00:00Z'],
    ['2026-02-30T00:00:00Z', '2026-03-02T00:00:00Z'],
    ['2026-07-01', '2026-07-02'],
    ['2026-07-02T00:00:00Z', '2026-07-01T00:00:00Z'],
    ['2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'],
  ])('rejects invalid or missing instant bounds (%s, %s)', (startInstant, endInstantExclusive) => {
    expect(parseParkingInstantRange(startInstant, endInstantExclusive)).toBeNull();
    const result = summarizeParkingMock(sampleDrives(1), {
      nowMs: Date.parse('2027-01-01T00:00:00Z'),
      startInstant, endInstantExclusive, timeZone: datePreferences.tz,
    });
    expect(result.coverage.invalidRange).toBe(true);
    expect(result.coverage.rangeStartMs).toBeNull();
    expect(result.stints).toEqual([]);
    expect(result.parkedShare).toBeNull();
  });

  it('keeps exact offset and rolling bounds instead of expanding them to days', () => {
    expect(parseParkingInstantRange('2026-07-01T12:34:56+05:30', '2026-07-02T12:34:56+05:30')).toEqual({
      startMs: Date.parse('2026-07-01T07:04:56Z'),
      endExclusiveMs: Date.parse('2026-07-02T07:04:56Z'),
    });
  });

  it('uses authoritative rolling instants and timezone without reconstructing calendar days', () => {
    const startInstant = '2026-07-01T12:34:56.789Z';
    const endInstantExclusive = '2026-07-02T12:34:56.789Z';
    sharedRange.rolling = { active: true, startInstant, endInstantExclusive, timezone: 'Asia/Kolkata' };
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(endInstantExclusive));
    useDrivesMock.mockReturnValue(query({ data: [{
      ...sampleDrives(1)[0], startTs: startInstant, endTs: startInstant,
    }] }));
    render(<ParkingAnalyticsPage />, { wrapper: MemoryRouter });
    expect(useDrivesMock).toHaveBeenLastCalledWith('42', {
      start: startInstant, end: endInstantExclusive, limit: 1_000,
    });
    expect(summarizeParkingMock.mock.calls.at(-1)?.[1]).toMatchObject({
      startInstant, endInstantExclusive, timeZone: 'Asia/Kolkata',
    });
    expect(summarizeParkingMock.mock.results.at(-1)?.value).toMatchObject({
      totalParkedMs: 24 * 3_600_000,
      coverage: { invalidRange: false, ongoingStints: 0 },
    });
  });

  it('renders instant methodology and the frozen edge in the saved locale and timezone', () => {
    datePreferences.locale = 'de-DE';
    datePreferences.tz = 'Europe/Berlin';
    const start = '2026-07-01T22:00:00.000Z';
    const end = '2026-07-02T22:00:00.000Z';
    const drive = {
      ...sampleDrives(1)[0], startTs: start, endTs: start,
    };
    const summary = summarizeParkingMock([drive], {
      nowMs: Date.parse('2026-08-01T00:00:00Z'),
      startInstant: start, endInstantExclusive: end, timeZone: datePreferences.tz,
    });
    render(<ParkingMethodCaveats summary={summary} rangeStart={start} rangeEnd={end} />);
    expect(screen.getByText(/as exact instants/)).toHaveTextContent(`${end} (exclusive)`);
    expect(screen.queryByText(/UTC calendar dates/)).not.toBeInTheDocument();
    expect(screen.getByText(/Hour, weekday/)).toHaveTextContent('Europe/Berlin');
    const localizedEdge = new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short',
    }).format(new Date(end));
    expect(screen.getByText(/right-censored/)).toHaveTextContent(localizedEdge);
  });
});
