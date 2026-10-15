import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { Drive } from '@/types/driving';
import type { UtilizationSummary } from '../lib/utilization';
import { calendarRangeToInstants } from '@/lib/dateRange';

const {
  drivesMock,
  formattingMock,
  pageTitleMock,
  rangeMock,
  sectionStateMock,
  selectedVehicleMock,
  summaryMock,
  datePreferences,
  requestMock,
} = vi.hoisted(() => ({
  drivesMock: vi.fn(),
  formattingMock: vi.fn(),
  pageTitleMock: vi.fn(),
  rangeMock: vi.fn(),
  sectionStateMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  summaryMock: vi.fn(),
  datePreferences: { tz: 'UTC', locale: 'en-US' },
  requestMock: vi.fn(),
}));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => datePreferences,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      fallback: string,
      values?: Record<string, unknown>,
    ) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) =>
          text.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      ),
  }),
}));

vi.mock('@/api/client', () => ({ request: (...args: unknown[]) => requestMock(...args) }));

vi.mock('@/api/hooks/useDriving', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/hooks/useDriving')>();
  return {
    ...original,
    useDriveCalendarHistory: (vehicleId?: string, start?: string, end?: string) =>
      drivesMock(vehicleId, { start, end, limit: 1000 })
        ?? original.useDriveCalendarHistory(vehicleId, start, end),
  };
});

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => formattingMock(),
}));

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: (title: string) => pageTitleMock(title),
}));

vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: (...args: unknown[]) => rangeMock(...args),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => selectedVehicleMock(),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
  RangePicker: ({
    value,
    triggerTestId,
  }: {
    value: { start: string; end: string };
    triggerTestId: string;
  }) => (
    <div
      data-testid={triggerTestId}
      data-start={value.start}
      data-end={value.end}
    />
  ),
}));

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

vi.mock('@/components/motion', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/motion')>(),
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/onboarding/components/NoVehicleSelected', () => ({
  NoVehicleSelected: ({ pageTitle }: { pageTitle: string }) => (
    <div data-testid="no-vehicle">{pageTitle}</div>
  ),
}));

vi.mock('../components/utilization', () => {
  type State = {
    isLoading: boolean;
    error: unknown;
    onRetry: () => void;
  };
  type SectionProps = {
    summary: UtilizationSummary;
    state: State;
  };
  const status = (summary: UtilizationSummary, state: State) =>
    state.error
      ? 'error'
      : state.isLoading
        ? 'loading'
        : summary.accounting.eligibleRows === 0
          ? 'empty'
          : 'ready';
  const section = (
    testId: string,
    summary: UtilizationSummary,
    state: State,
  ) => {
    sectionStateMock(testId, state.onRetry);
    summaryMock(summary);
    return (
      <section
        data-testid={testId}
        data-as-of={summary.window.asOfMs}
        data-start={summary.window.rangeStart}
        data-end={summary.window.rangeEnd}
      >
        {status(summary, state)}
      </section>
    );
  };

  return {
    UtilizationKpis: ({
      summary,
      isLoading,
      error,
      onRetry,
    }: {
      summary: UtilizationSummary;
      isLoading: boolean;
      error: unknown;
      onRetry: () => void;
    }) =>
      section('utilization-kpis', summary, {
        isLoading,
        error,
        onRetry,
      }),
    TimeCostOverview: (props: SectionProps) =>
      section('utilization-time-cost', props.summary, props.state),
    UtilizationTrend: (props: SectionProps) =>
      section('utilization-trend', props.summary, props.state),
    WeekdayProfile: (props: SectionProps) =>
      section('utilization-weekday', props.summary, props.state),
    DriveDistributions: (props: SectionProps) =>
      section(
        'utilization-distributions',
        props.summary,
        props.state,
      ),
    ActiveDayConsistency: (props: SectionProps) =>
      section(
        'utilization-consistency',
        props.summary,
        props.state,
      ),
    BusiestDays: (props: SectionProps) =>
      section('utilization-busiest', props.summary, props.state),
    UtilizationMethodology: (props: SectionProps) =>
      section('utilization-method', props.summary, props.state),
  };
});

import UtilizationPage from './UtilizationPage';

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isPending: false,
    isSuccess: true,
    status: 'success',
    fetchStatus: 'idle',
    isStale: false,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
    ...overrides,
  };
}

function eligibleDrive(): Drive {
  return {
    id: 1,
    vehicleId: 42,
    startTs: '2026-07-10T12:00:00.000Z',
    endTs: '2026-07-10T12:30:00.000Z',
    durationS: 1_800,
    distanceM: 10_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 75,
    energyUsedWh: 2_000,
    regenEnergyWh: null,
    avgSpeedMps: 10,
    maxSpeedMps: 20,
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
  'utilization-kpis',
  'utilization-time-cost',
  'utilization-trend',
  'utilization-weekday',
  'utilization-distributions',
  'utilization-consistency',
  'utilization-busiest',
  'utilization-method',
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-07T18:26:55.198-07:00'));
  datePreferences.tz = 'UTC';
  datePreferences.locale = 'en-US';
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  formattingMock.mockReturnValue({ costPerKwh: 0.15, currencySymbol: '$', formatCurrency: (amount: number) => `$${amount.toFixed(2)}` });
  rangeMock.mockReturnValue({
    start: '2026-07-01',
    end: '2026-07-31',
    startInstant: '2026-07-01T00:00:00.000Z',
    endInstantExclusive: '2026-08-01T00:00:00.000Z',
    setRange: vi.fn(),
  });
  drivesMock.mockReturnValue(query({ data: [eligibleDrive()] }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('UtilizationPage', () => {
  function latestSummary(): UtilizationSummary {
    return summaryMock.mock.calls.at(-1)![0] as UtilizationSummary;
  }

  it('passes unknown weekdays and observed inactive zero rates through the page without defaulting them', () => {
    rangeMock.mockReturnValue({
      start: '2026-07-10', end: '2026-07-11',
      startInstant: '2026-07-10T00:00:00.000Z',
      endInstantExclusive: '2026-07-12T00:00:00.000Z',
    });
    drivesMock.mockReturnValue(query({ data: [{ ...eligibleDrive(), distanceM: 12.345 }] }));
    render(<UtilizationPage />, { wrapper: MemoryRouter });
    expect(latestSummary().weekdays[0]).toMatchObject({
      observedDays: 0, activeDayShare: null, averageDistancePerActiveDayM: null,
    });
    expect(latestSummary().weekdays[6]).toMatchObject({
      observedDays: 1, activeDays: 0, activeDayShare: 0, averageDistancePerActiveDayM: null,
    });
    expect(latestSummary().weekdays[5].averageDistancePerActiveDayM).toBe(12.345);
  });

  it.each([
    ['2026-03-08', '2026-03-09T07:00:00.000Z', 23],
    ['2026-11-01', '2026-11-02T08:00:00.000Z', 25],
  ])('uses saved timezone bounds across DST on %s without changing calendar labels', (day, exclusiveEnd, hours) => {
    datePreferences.tz = 'America/Los_Angeles';
    datePreferences.locale = 'de-DE';
    vi.setSystemTime(new Date('2026-12-01T00:00:00Z'));
    const bounds = calendarRangeToInstants({
      startDate: day, endDate: day, timezone: datePreferences.tz,
    });
    rangeMock.mockReturnValue({ start: day, end: day, ...bounds });
    const lower = Date.parse(bounds.startInstant);
    const upper = Date.parse(bounds.endInstantExclusive);
    drivesMock.mockReturnValue(query({ data: [
      { ...eligibleDrive(), id: 1, startTs: new Date(lower - 1).toISOString() },
      { ...eligibleDrive(), id: 2, startTs: bounds.startInstant },
      { ...eligibleDrive(), id: 3, startTs: new Date(upper - 1).toISOString() },
      { ...eligibleDrive(), id: 4, startTs: bounds.endInstantExclusive },
    ] }));
    render(<UtilizationPage />, { wrapper: MemoryRouter });
    expect(rangeMock).toHaveBeenCalledWith(expect.objectContaining({ timezone: datePreferences.tz }));
    expect(drivesMock).toHaveBeenLastCalledWith('42', {
      start: bounds.startInstant, end: exclusiveEnd, limit: 1000,
    });
    const summary = latestSummary();
    expect(summary.window.rangeStart).toBe(day);
    expect(summary.window.rangeEnd).toBe(day);
    expect(summary.window.selectedStartMs).toBe(lower);
    expect(summary.window.selectedEndExclusiveMs).toBe(upper);
    expect(summary.window.observedDurationS).toBe(hours * 3600);
    expect(summary.drivingShare).toBeCloseTo((1800 + 0.001) / (hours * 3600));
    expect(summary.accounting).toMatchObject({
      returnedRows: 4, eligibleRows: 2, beforeRangeRows: 1, afterRangeRows: 1,
      truncatedDurationRows: 1,
    });
    expect(screen.getByTestId('utilization-summary')).toHaveTextContent(`Requested ${day} → ${day}`);
    expect(screen.queryByTestId('utilization-range')).not.toBeInTheDocument();
  });

  it('uses the actual observed window rather than the full requested duration', () => {
    rangeMock.mockReturnValue({
      start: '2026-07-10', end: '2026-07-10',
      startInstant: '2026-07-10T07:00:00.000Z',
      endInstantExclusive: '2026-07-11T07:00:00.000Z',
    });
    render(<UtilizationPage />, { wrapper: MemoryRouter });
    const summary = latestSummary();
    expect(summary.window.observedDurationS).toBe(19 * 3600);
    expect(summary.drivingShare).toBeCloseTo(1800 / (19 * 3600));
    expect(summary.days.reduce((sum, day) => sum + day.observedS, 0)).toBe(19 * 3600);
  });

  it.each([
    ['', ''],
    ['invalid', '2026-08-01T00:00:00.000Z'],
    ['2026-08-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'],
    ['2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'],
  ])('keeps invalid or missing precise bounds unknown: %s / %s', (startInstant, endInstantExclusive) => {
    rangeMock.mockReturnValue({ start: '', end: '', startInstant, endInstantExclusive });
    render(<UtilizationPage />, { wrapper: MemoryRouter });
    expect(latestSummary().window.rangeValid).toBe(false);
    expect(latestSummary().accounting.invalidRangeRows).toBe(1);
    expect(latestSummary().drivingShare).toBeNull();
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toBeInTheDocument();
  });

  it('accounts for invalid and missing drive dates without inventing an observed window', () => {
    drivesMock.mockReturnValue(query({ data: [
      { ...eligibleDrive(), startTs: '' },
      { ...eligibleDrive(), id: 2, startTs: 'invalid' },
    ] }));
    render(<UtilizationPage />, { wrapper: MemoryRouter });
    expect(latestSummary().accounting.invalidTimestampRows).toBe(2);
    expect(latestSummary().window.observedStartMs).toBeNull();
    expect(latestSummary().drivingShare).toBeNull();
  });

  it('rebases a frozen analysis when rolling header bounds advance, even with unchanged labels', () => {
    const firstNow = Date.parse('2026-07-10T13:00:00.000Z');
    vi.setSystemTime(firstNow);
    rangeMock.mockReturnValue({
      start: '2026-07-09', end: '2026-07-10',
      startInstant: '2026-07-09T13:00:00.000Z',
      endInstantExclusive: '2026-07-10T13:00:00.000Z',
    });
    const view = render(<UtilizationPage />, { wrapper: MemoryRouter });
    expect(latestSummary().window.asOfMs).toBe(firstNow);
    vi.setSystemTime(firstNow + 60_000);
    rangeMock.mockReturnValue({
      start: '2026-07-09', end: '2026-07-10',
      startInstant: '2026-07-09T13:01:00.000Z',
      endInstantExclusive: '2026-07-10T13:01:00.000Z',
    });
    view.rerender(<UtilizationPage />);
    expect(latestSummary().window.asOfMs).toBe(firstNow + 60_000);
    expect(latestSummary().window.observedDurationS).toBe(3660);
    expect(drivesMock).toHaveBeenLastCalledWith('42', {
      start: '2026-07-09T13:01:00.000Z', end: '2026-07-10T13:01:00.000Z', limit: 1000,
    });
  });

  it('mounts all sections and sends the selected date scope to complete history', () => {
    render(<UtilizationPage />, { wrapper: MemoryRouter });

    expect(
      screen.getByRole('heading', { name: 'Utilization' }),
    ).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      if (id === 'utilization-kpis') expect(screen.getByTestId(id)).toHaveTextContent('Source returned');
      else expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(drivesMock).toHaveBeenCalledWith('42', {
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
      limit: 1000,
    });
    expect(screen.queryByTestId('utilization-range')).not.toBeInTheDocument();
    expect(pageTitleMock).toHaveBeenCalledWith('Utilization');

    const retryCallbacks = sectionStateMock.mock.calls.map(
      (call) => call[1],
    );
    expect(new Set(retryCallbacks).size).toBe(1);
  });

  it('threads loading, error, and empty states to every mounted section', () => {
    drivesMock.mockReturnValue(query({
      data: undefined, isPending: true, isLoading: true, isFetching: true,
      isSuccess: false, status: 'pending', fetchStatus: 'fetching',
    }));
    const view = render(<UtilizationPage />, { wrapper: MemoryRouter });
    for (const id of SECTION_IDS) {
      if (id === 'utilization-kpis') expect(screen.getByTestId('utilization-summary')).toHaveAttribute('aria-busy', 'true');
      else expect(screen.getByTestId(id)).toHaveTextContent('loading');
    }

    drivesMock.mockReturnValue(
      query({
        data: undefined,
        isError: true,
        error: new Error('drive history unavailable'),
      }),
    );
    view.rerender(<UtilizationPage />);
    for (const id of SECTION_IDS) {
      if (id === 'utilization-kpis') expect(screen.getByTestId(id)).toHaveTextContent('Source unavailable');
      else expect(screen.getByTestId(id)).toHaveTextContent('error');
    }

    drivesMock.mockReturnValue(query({ data: [] }));
    view.rerender(<UtilizationPage />);
    for (const id of SECTION_IDS) {
      if (id === 'utilization-kpis') expect(screen.getByTestId(id)).toHaveTextContent('No drives in this period yet.');
      else expect(screen.getByTestId(id)).toHaveTextContent('empty');
    }
  });

  it('updates the server scope when the selected range changes', () => {
    const view = render(<UtilizationPage />, { wrapper: MemoryRouter });
    rangeMock.mockReturnValue({
      start: '2026-06-01',
      end: '2026-06-30',
      startInstant: '2026-06-01T00:00:00.000Z',
      endInstantExclusive: '2026-07-01T00:00:00.000Z',
      setRange: vi.fn(),
    });

    view.rerender(<UtilizationPage />);

    expect(drivesMock).toHaveBeenLastCalledWith('42', {
      start: '2026-06-01T00:00:00.000Z',
      end: '2026-07-01T00:00:00.000Z',
      limit: 1000,
    });
    expect(screen.getByTestId('utilization-trend')).toHaveAttribute(
      'data-start',
      '2026-06-01',
    );
    expect(screen.getByTestId('utilization-trend')).toHaveAttribute(
      'data-end',
      '2026-06-30',
    );
  });

  it('freezes the as-of clock for the lifetime of the page mount', () => {
    const view = render(<UtilizationPage />, { wrapper: MemoryRouter });
    const firstAsOf = screen
      .getByTestId('utilization-kpis')
      .getAttribute('data-as-of');

    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    view.rerender(<UtilizationPage />);

    expect(
      screen
        .getByTestId('utilization-kpis')
        .getAttribute('data-as-of'),
    ).toBe(firstAsOf);
  });

  it('keeps the no-vehicle recovery state and disables the ranged query', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    render(<UtilizationPage />, { wrapper: MemoryRouter });

    expect(screen.getByTestId('no-vehicle')).toHaveTextContent(
      'Utilization',
    );
    expect(drivesMock).toHaveBeenCalledWith(undefined, {
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
      limit: 1000,
    });

    expect(
      screen.queryByTestId('utilization-method'),
    ).not.toBeInTheDocument();
  });

  it('keeps retained eligible drives in all eight sections when refresh fails', () => {
    drivesMock.mockReturnValue(query({ data: [eligibleDrive()], isError: true, error: new Error('refresh failed') }));
    render(<UtilizationPage />, { wrapper: MemoryRouter });
    for (const id of SECTION_IDS) {
      if (id === 'utilization-kpis') expect(screen.getByTestId(id)).toHaveTextContent('Retained source snapshots');
      else expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(drivesMock).toHaveBeenCalledWith('42', { start: '2026-07-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z', limit: 1000 });
  });

  it('opens the real review drawer with UTC-day denominators and energy-only cost context', () => {
    render(<UtilizationPage />, { wrapper: MemoryRouter });
    const brief = screen.getByTestId('utilization-summary');
    const distance = brief.querySelector('[data-operational-metric="distance-per-day"]');
    if (!(distance instanceof HTMLElement)) throw new Error('Distance evidence missing');
    expect(distance).toHaveAttribute('data-value-state', 'value');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText(/observed UTC days/)).toBeInTheDocument();
    expect(within(drawer).getByText('energy only')).toBeInTheDocument();
    expect(within(drawer).getByText('1 drives')).toBeInTheDocument();
  });
});


// Additive coverage: the original assertions and fixture prefix remain unchanged.
import { deriveDataState } from '@/api/dataState';

describe('UtilizationPage source coverage', () => {
  it('keeps paused-without-data operands unknown, then recovers to measured zero', () => {
    const refetch = vi.fn();
    drivesMock.mockReturnValue(query({
      data: undefined, isPending: true, isLoading: false, isSuccess: false,
      status: 'pending', fetchStatus: 'paused', refetch,
    }));
    const view = render(<UtilizationPage />, { wrapper: MemoryRouter });
    const brief = screen.getByTestId('utilization-summary');
    for (const id of ['driving-share', 'distance-per-day', 'cost-per-distance']) {
      expect(brief.querySelector(`[data-operational-metric="${id}"]`)).toHaveAttribute('data-value-state', 'missing');
    }
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(brief).toHaveTextContent('Pending');
    expect(brief).not.toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No drives in this period yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('Source unavailable')).not.toBeInTheDocument();
    for (const id of SECTION_IDS.slice(1)) {
      const section = within(screen.getByTestId(id));
      expect(section.getByRole('status')).toHaveTextContent('Refresh paused');
      expect(section.getByRole('status')).toHaveTextContent('missing evidence is not a confirmed empty result');
    }
    fireEvent.click(within(screen.getByTestId('utilization-trend')).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(summaryMock).not.toHaveBeenCalled();
    drivesMock.mockReturnValue(query({
      data: [{ ...eligibleDrive(), durationS: 0, distanceM: 0, energyUsedWh: 0 }],
    }));
    view.rerender(<UtilizationPage />);
    expect(brief.querySelector('[data-operational-metric="driving-share"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief.querySelector('[data-operational-metric="distance-per-day"]')).toHaveAttribute('data-value-state', 'value');
    expect(summaryMock.mock.calls.at(-1)![0].accounting.usableEnergyRows).toBe(1);
    expect(summaryMock.mock.calls.at(-1)![0].totalEnergyCost).toBe(0);
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
    expect(brief.querySelector('[data-operational-metric="driving-share"]')).toHaveTextContent(/0(?:[.,]0+)?%/);
    expect(brief.querySelector('[data-operational-metric="distance-per-day"]')).toHaveTextContent('0');
  });

  it('keeps an idle pending source distinct from confirmed empty history', () => {
    drivesMock.mockReturnValue(query({
      data: undefined, isPending: true, isSuccess: false, status: 'pending',
    }));
    const view = render(<UtilizationPage />, { wrapper: MemoryRouter });
    expect(screen.getByTestId('utilization-summary')).toHaveTextContent('Pending');
    expect(screen.queryByText('No drives in this period yet.')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('utilization-trend')).getByRole('status')).toHaveTextContent('This source has not resolved yet');
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
    drivesMock.mockReturnValue(query());
    view.rerender(<UtilizationPage />);
    expect(screen.getByTestId('utilization-summary')).toHaveTextContent('Source returned');
    expect(screen.getByText('No drives in this period yet.')).toBeInTheDocument();
    for (const id of SECTION_IDS.slice(1)) expect(screen.getByTestId(id)).toHaveTextContent('empty');
  });

  it('retains partial rollup coverage during refresh failure and replaces it on recovery', () => {
    const retained = [{ ...eligibleDrive(), durationS: null, distanceM: null, energyUsedWh: null }];
    drivesMock.mockReturnValue(query({ data: retained }));
    const view = render(<UtilizationPage />, { wrapper: MemoryRouter });
    const first = summaryMock.mock.calls.at(-1)![0] as UtilizationSummary;
    expect(first.days[0].coverage).toMatchObject({ excludedDurationRows: 1, excludedDistanceRows: 1, excludedEnergyRows: 1 });
    drivesMock.mockReturnValue(query({ data: retained, isError: true, error: new Error('refresh failed') }));
    view.rerender(<UtilizationPage />);
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(summaryMock.mock.calls.at(-1)![0]).toBe(first);
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toBeInTheDocument();
    drivesMock.mockReturnValue(query({ data: [eligibleDrive()], dataUpdatedAt: 2 }));
    view.rerender(<UtilizationPage />);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(summaryMock.mock.calls.at(-1)![0].days[0].coverage).toMatchObject({ usableDurationRows: 1, excludedDurationRows: 0, usableDistanceRows: 1, usableEnergyRows: 1 });
  });

  it('keeps missing duration and distance unknown in the numeric brief', () => {
    drivesMock.mockReturnValue(query({ data: [{ ...eligibleDrive(), durationS: null, distanceM: null, energyUsedWh: null }] }));
    render(<UtilizationPage />, { wrapper: MemoryRouter });
    const brief = screen.getByTestId('utilization-summary');
    expect(brief).toHaveTextContent('Partial source coverage');
    for (const id of ['driving-share', 'distance-per-day', 'cost-per-distance']) {
      expect(brief.querySelector(`[data-operational-metric="${id}"]`)).toHaveAttribute('data-value-state', 'missing');
    }
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toBeInTheDocument();
  });

  describe('UtilizationPage complete server history', () => {
    function renderHistory() {
      vi.useRealTimers();
      drivesMock.mockReturnValue(undefined);
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      });
      const view = render(
        <QueryClientProvider client={client}>
          <MemoryRouter><UtilizationPage /></MemoryRouter>
        </QueryClientProvider>,
      );
      return { ...view, client };
    }

    function firstPage() {
      return Array.from({ length: 1000 }, (_, index) => ({
        ...eligibleDrive(), id: index + 1,
      }));
    }

    it('waits for all pages, preserves exact scope and signal, and includes older drives in utilization', async () => {
      let finishPage!: (rows: Drive[]) => void;
      requestMock
        .mockResolvedValueOnce(firstPage())
        .mockReturnValueOnce(new Promise<Drive[]>(resolve => { finishPage = resolve; }));
      const view = renderHistory();

      await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
      expect(screen.getByTestId('utilization-summary')).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByTestId('utilization-summary')).not.toHaveTextContent('Source returned');
      expect(summaryMock.mock.calls.at(-1)![0].drives).toBe(0);
      const signals = requestMock.mock.calls.map(([url, options], index) => {
        const params = new URL(String(url), 'http://localhost').searchParams;
        expect(params.get('vehicle_id')).toBe('42');
        expect(params.get('start')).toBe('2026-07-01T00:00:00.000Z');
        expect(params.get('end')).toBe('2026-08-01T00:00:00.000Z');
        expect(params.get('limit')).toBe('1000');
        expect(params.get('offset')).toBe(String(index * 1000));
        return options.signal as AbortSignal;
      });
      expect(signals[0]).toBeInstanceOf(AbortSignal);
      expect(signals[1]).toBe(signals[0]);
      await act(async () => finishPage([
        { ...eligibleDrive(), id: 1001, startTs: '2026-07-02T12:00:00.000Z', endTs: '2026-07-02T12:30:00.000Z' },
      ]));
      await waitFor(() => expect(screen.getByTestId('utilization-summary')).toHaveTextContent('Source returned'));
      const summary = summaryMock.mock.calls.at(-1)![0] as UtilizationSummary;
      expect(summary.drives).toBe(1001);
      expect(summary.accounting.returnedRows).toBe(1001);
      expect(summary.accounting.historyCapReached).toBe(false);
      expect(summary.consistency.activeDays).toBe(2);
      expect(summary.window.observedStartMs).toBe(Date.parse('2026-07-02T12:00:00.000Z'));
      for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toBeInTheDocument();
      view.unmount();
      view.client.clear();
    });

    it('does not publish a successful first page when a later page fails and retries the complete history', async () => {
      requestMock
        .mockResolvedValueOnce(firstPage())
        .mockRejectedValueOnce(new Error('second page unavailable'));
      const view = renderHistory();
      await waitFor(() => expect(screen.getByTestId('utilization-summary')).toHaveTextContent('Source unavailable'));
      expect(summaryMock.mock.calls.at(-1)![0].drives).toBe(0);
      expect(screen.getByTestId('utilization-summary')).not.toHaveTextContent('Source returned');
      requestMock.mockResolvedValueOnce(firstPage()).mockResolvedValueOnce([]);
      fireEvent.click(within(screen.getByTestId('utilization-kpis')).getByRole('button', { name: /retry/i }));
      await waitFor(() => expect(screen.getByTestId('utilization-summary')).toHaveTextContent('Source returned'));
      expect(requestMock).toHaveBeenCalledTimes(4);
      expect(summaryMock.mock.calls.at(-1)![0].drives).toBe(1000);
      expect(summaryMock.mock.calls.at(-1)![0].accounting.historyCapReached).toBe(false);
      view.unmount();
      view.client.clear();
    });

    it('cancels an in-flight later page when the page unmounts', async () => {
      requestMock.mockResolvedValueOnce(firstPage()).mockReturnValueOnce(new Promise(() => {}));
      const view = renderHistory();
      await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
      const signal = requestMock.mock.calls[1][1].signal as AbortSignal;
      expect(signal.aborted).toBe(false);
      view.unmount();
      expect(signal.aborted).toBe(true);
      view.client.clear();
    });

    it('discloses partial coverage during paginated refresh and retains the previous complete result on failure', async () => {
      let failPage!: (error: Error) => void;
      requestMock.mockResolvedValueOnce([eligibleDrive()]);
      const view = renderHistory();
      await waitFor(() => expect(screen.getByTestId('utilization-summary')).toHaveTextContent('Source returned'));
      requestMock
        .mockResolvedValueOnce(firstPage())
        .mockReturnValueOnce(new Promise<Drive[]>((_resolve, reject) => { failPage = reject; }));
      act(() => { void view.client.refetchQueries(); });
      await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(3));
      expect(screen.getByTestId('utilization-summary')).toHaveTextContent('Partial source coverage');
      expect(summaryMock.mock.calls.at(-1)![0].drives).toBe(1);
      await act(async () => failPage(new Error('refresh second page unavailable')));
      await waitFor(() => expect(screen.getByTestId('utilization-summary')).toHaveTextContent('Retained source snapshots'));
      expect(summaryMock.mock.calls.at(-1)![0].drives).toBe(1);
      expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
      view.unmount();
      view.client.clear();
    });
  });

  it('does not mistake a completed 1000-row history for a capped response', () => {
    drivesMock.mockReturnValue(query({ data: Array.from({ length: 1000 }, (_, index) => ({ ...eligibleDrive(), id: index + 1 })) }));
    render(<UtilizationPage />, { wrapper: MemoryRouter });
    expect(screen.getByTestId('utilization-summary')).toHaveTextContent('Source returned');
    expect(summaryMock.mock.calls.at(-1)![0].accounting.historyCapReached).toBe(false);
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(drivesMock).toHaveBeenCalledWith('42', { start: '2026-07-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z', limit: 1000 });
  });

  it('preserves retained-drive trust ahead of the cap disclosure and retries only drives', () => {
    const refetch = vi.fn();
    drivesMock.mockReturnValue(query({ data: Array.from({ length: 1000 }, (_, index) => ({ ...eligibleDrive(), id: index + 1 })), isError: true, error: new Error('refresh failed'), refetch }));
    render(<UtilizationPage />, { wrapper: MemoryRouter });
    expect(screen.getByTestId('utilization-summary')).toHaveTextContent('Retained source snapshots');
    fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toBeInTheDocument();
  });

  it('keeps drive metrics visible while the independent electricity rate loads', () => {
    formattingMock.mockReturnValue({ costPerKwh: 0.15, formatCurrency: (amount: number) => `$${amount.toFixed(2)}`, pricingState: deriveDataState({ isPending: true }) });
    render(<UtilizationPage />, { wrapper: MemoryRouter });
    expect(within(screen.getByTestId('utilization-pricing')).getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('utilization-summary').querySelector('[data-operational-metric="cost-per-distance"]')).toHaveAttribute('data-value-state', 'missing');
    expect(screen.getByTestId('utilization-summary').querySelector('[data-operational-metric="distance-per-day"]')).toHaveAttribute('data-value-state', 'value');
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toBeInTheDocument();
  });

  it('retries an initial pricing failure independently without marking drives failed', () => {
    const refetch = vi.fn();
    const driveRefetch = vi.fn();
    drivesMock.mockReturnValue(query({ data: [eligibleDrive()], refetch: driveRefetch }));
    formattingMock.mockReturnValue({ costPerKwh: null, formatCurrency: (amount: number) => `$${amount.toFixed(2)}`, pricingState: deriveDataState({ data: undefined, isError: true, error: new Error('pricing unavailable'), refetch }) });
    const view = render(<UtilizationPage />, { wrapper: MemoryRouter });
    fireEvent.click(within(screen.getByTestId('utilization-pricing')).getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(driveRefetch).not.toHaveBeenCalled();
    expect(screen.getByTestId('utilization-summary')).toHaveTextContent('Source returned');
    for (const id of SECTION_IDS) {
      if (id !== 'utilization-kpis') expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    formattingMock.mockReturnValue({ costPerKwh: 0.15, formatCurrency: (amount: number) => `$${amount.toFixed(2)}`, pricingState: deriveDataState({ data: { base_cost_per_kwh: 0.15 } }) });
    view.rerender(<UtilizationPage />);
    expect(within(screen.getByTestId('utilization-pricing')).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByTestId('utilization-summary').querySelector('[data-operational-metric="cost-per-distance"]')).toHaveAttribute('data-value-state', 'value');
  });

  it('retains estimated costs with a source-specific warning after pricing refresh fails', () => {
    const refetch = vi.fn();
    const driveRefetch = vi.fn();
    drivesMock.mockReturnValue(query({ data: [eligibleDrive()], refetch: driveRefetch }));
    formattingMock.mockReturnValue({ costPerKwh: 0.15, formatCurrency: (amount: number) => `$${amount.toFixed(2)}`, pricingState: deriveDataState({ data: { base_cost_per_kwh: 0.15 }, isError: true, error: new Error('pricing refresh failed'), refetch }) });
    const view = render(<UtilizationPage />, { wrapper: MemoryRouter });
    const pricing = screen.getByTestId('utilization-pricing');
    expect(pricing).toHaveTextContent('Settings electricity rate may be out of date');
    expect(screen.getByTestId('utilization-summary').querySelector('[data-operational-metric="cost-per-distance"]')).toHaveAttribute('data-value-state', 'value');
    fireEvent.click(within(pricing).getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(driveRefetch).not.toHaveBeenCalled();
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toBeInTheDocument();
    formattingMock.mockReturnValue({ costPerKwh: 0, formatCurrency: (amount: number) => `$${amount.toFixed(2)}`, pricingState: deriveDataState({ data: { base_cost_per_kwh: 0 } }) });
    view.rerender(<UtilizationPage />);
    expect(within(pricing).queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(summaryMock.mock.calls.at(-1)![0].totalEnergyCost).toBe(0);
  });

  it('explains deferred pricing without blocking drive evidence and recovers independently', () => {
    const refetch = vi.fn();
    const driveRefetch = vi.fn();
    drivesMock.mockReturnValue(query({ data: [eligibleDrive()], refetch: driveRefetch }));
    formattingMock.mockReturnValue({ costPerKwh: 0.15, formatCurrency: (amount: number) => `$${amount.toFixed(2)}`, pricingState: deriveDataState({ isPending: true, fetchStatus: 'paused', refetch }) });
    const view = render(<UtilizationPage />, { wrapper: MemoryRouter });
    const pricing = within(screen.getByTestId('utilization-pricing'));
    expect(pricing.getByRole('status')).toHaveTextContent('Refresh paused');
    expect(pricing.getByRole('status')).not.toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('utilization-summary')).toHaveTextContent('Source returned');
    expect(screen.getByTestId('utilization-summary').querySelector('[data-operational-metric="cost-per-distance"]')).toHaveAttribute('data-value-state', 'missing');
    fireEvent.click(pricing.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(driveRefetch).not.toHaveBeenCalled();
    formattingMock.mockReturnValue({ costPerKwh: 0, formatCurrency: (amount: number) => `$${amount.toFixed(2)}`, pricingState: deriveDataState({ data: { base_cost_per_kwh: 0 } }) });
    view.rerender(<UtilizationPage />);
    expect(pricing.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByTestId('utilization-summary').querySelector('[data-operational-metric="cost-per-distance"]')).toHaveAttribute('data-value-state', 'value');
    expect(summaryMock.mock.calls.at(-1)![0].totalEnergyCost).toBe(0);
  });

  it('keeps paused pricing distinct from an initial drive error and retains its estimate', () => {
    formattingMock.mockReturnValue({ costPerKwh: 0.15, formatCurrency: (amount: number) => `$${amount.toFixed(2)}`, pricingState: deriveDataState({ data: { base_cost_per_kwh: 0.15 }, fetchStatus: 'paused', refetch: vi.fn() }) });
    render(<UtilizationPage />, { wrapper: MemoryRouter });
    expect(within(screen.getByTestId('utilization-pricing')).getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    expect(screen.getByTestId('utilization-summary')).toHaveTextContent('Source returned');
    expect(screen.getByTestId('utilization-summary').querySelector('[data-operational-metric="cost-per-distance"]')).toHaveAttribute('data-value-state', 'value');
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toBeInTheDocument();
  });
});
