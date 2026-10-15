import type { ChangeEvent, ComponentProps, ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Drive } from '@/types/driving';
import type { TargetSummary, WeekResult } from '../lib/efficiencyTarget';
import { downloadJSON } from '@/lib/csvExport';
import { CHART_COLORS_CB_SAFE, CHART_COLORS_NEON } from '@/lib/colors';

vi.mock('@/lib/csvExport', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/csvExport')>(),
  downloadJSON: vi.fn(),
}));

const {
  historyMock,
  pageTitleMock,
  selectedVehicleMock,
  setStoredNumberMock,
  storedNumberMock,
  unitsMock,
  pulseRenderMock,
  paletteMock,
  weekdayChartMock,
  weekdayBarMock,
  weekdayReferenceMock,
  weekdayContainerMock,
} = vi.hoisted(() => ({
  historyMock: vi.fn(),
  pageTitleMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  setStoredNumberMock: vi.fn(),
  storedNumberMock: vi.fn(),
  unitsMock: vi.fn(),
  pulseRenderMock: vi.fn(),
  paletteMock: vi.fn(),
  weekdayChartMock: vi.fn(),
  weekdayBarMock: vi.fn(),
  weekdayReferenceMock: vi.fn(),
  weekdayContainerMock: vi.fn(),
}));

vi.mock('@/hooks/useChartPalette', () => ({
  useChartPalette: () => paletteMock(),
}));

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  return {
    ...actual,
    BarChart: (props: ComponentProps<typeof actual.BarChart>) => {
      weekdayChartMock(props);
      return <div>{props.children}</div>;
    },
    Bar: (props: ComponentProps<typeof actual.Bar>) => {
      weekdayBarMock(props);
      return null;
    },
    ReferenceLine: (props: ComponentProps<typeof actual.ReferenceLine>) => {
      weekdayReferenceMock(props);
      return null;
    },
    ChartContainer: (props: ComponentProps<typeof actual.ChartContainer>) => {
      weekdayContainerMock(props);
      return <actual.ChartContainer {...props} />;
    },
    ResponsiveContainer: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
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

vi.mock('@/hooks/useStoredNumber', () => ({
  useStoredNumber: (...args: unknown[]) => storedNumberMock(...args),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => unitsMock(),
}));

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

vi.mock('@/components/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/ui')>(),
  HelpTooltip: ({ ariaLabel }: { ariaLabel: string }) => <span aria-label={ariaLabel} />,
  Input: ({
    'aria-label': ariaLabel,
    value,
    label,
    error,
    hint,
    onChange,
    suffix,
  }: {
    'aria-label': string;
    value: string;
    label: string;
    error?: string;
    hint?: string;
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
    suffix: ReactNode;
  }) => (
    <label>
      {label}
      <input
        aria-label={ariaLabel}
        aria-invalid={error ? 'true' : undefined}
        value={value}
        onChange={onChange}
      />
      {suffix}
      {error && <span role="alert">{error}</span>}
      {hint && <span>{hint}</span>}
    </label>
  ),
  Caption: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/components/layout', () => ({
  PageLayout: ({
    title,
    subtitle,
    contextActions,
    children,
  }: {
    title: string;
    subtitle: string;
    contextActions: ReactNode;
    children: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {contextActions}
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

vi.mock('../components/efficiency-target', () => {
  type State = { isLoading: boolean; error: unknown };
  const status = (state: State) =>
    state.error ? 'error' : state.isLoading ? 'loading' : 'ready';
  const section = (testId: string, state: State, target?: number) => (
    <section data-testid={testId} data-target={target}>
      {status(state)}
    </section>
  );

  return {
    EfficiencyTargetKpis: (props: {
      state: State;
      targetWhPerKm: number;
      retained: boolean;
    }) =>
      <div data-testid="target-trust" data-retained={props.retained}>
        {section('efficiency-target-kpis', props.state, props.targetWhPerKm)}
      </div>,
    GoalPulse: (props: { state: State; summary: TargetSummary }) => {
      pulseRenderMock();
      return (
        <section data-testid="efficiency-target-pulse">
          {status(props.state)}
          <output aria-label="Observed consumption">{props.summary.overallWhPerKm ?? 'unknown'}</output>
          <output aria-label="Completed weeks">{props.summary.completedWeeks.length}</output>
          <output aria-label="Active consumption">{props.summary.activeWeek?.whPerKm ?? 'unknown'}</output>
          <output aria-label="Completed target gap">{props.summary.latestCompletedWeek?.targetGapWhPerKm ?? 'unknown'}</output>
          <output aria-label="Eligible drives">{props.summary.analyzed}</output>
        </section>
      );
    },
    TargetConsistencyChart: (props: { state: State }) =>
      section('efficiency-target-consistency', props.state),
    WeeklyTargetChart: (props: {
      state: State;
      targetWhPerKm: number;
    }) =>
      section(
        'efficiency-target-weekly',
        props.state,
        props.targetWhPerKm,
      ),
    WeekdayEfficiencyChart: (props: { state: State }) =>
      section('efficiency-target-weekday', props.state),
    RecentWeekScorecard: (props: { state: State }) =>
      section('efficiency-target-scorecard', props.state),
    TargetMethodology: (props: { state: State }) =>
      section('efficiency-target-method', props.state),
  };
});

vi.mock('../components/operationalbrief-a-m/EfficiencyTargetBrief', async () => ({
  EfficiencyTargetBrief: (await import('../components/efficiency-target')).EfficiencyTargetKpis,
}));

import EfficiencyTargetPage from './EfficiencyTargetPage';
import { TargetMethodology } from '../components/efficiency-target/TargetMethodology';
import { GoalPulse } from '../components/efficiency-target/GoalPulse';
import { RecentWeekScorecard } from '../components/efficiency-target/RecentWeekScorecard';
import { WeekdayEfficiencyChart } from '../components/efficiency-target/WeekdayEfficiencyChart';
import { summarizeTarget } from '../lib/efficiencyTarget';

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

function drive(startTs: string, distanceM: number, energyUsedWh: number | null): Drive {
  return {
    id: 1,
    vehicleId: 42,
    startTs,
    endTs: startTs,
    durationS: 600,
    distanceM,
    energyUsedWh,
    regenEnergyWh: null,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: null,
    endBatteryPct: null,
    avgSpeedMps: null,
    maxSpeedMps: null,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: startTs,
    updatedAt: startTs,
  };
}

const SECTION_IDS = [
  'efficiency-target-kpis',
  'efficiency-target-pulse',
  'efficiency-target-consistency',
  'efficiency-target-weekly',
  'efficiency-target-weekday',
  'efficiency-target-scorecard',
  'efficiency-target-method',
];

beforeEach(() => {
  vi.clearAllMocks();
  pulseRenderMock.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 7, 12));
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  historyMock.mockReturnValue(query());
  storedNumberMock.mockReturnValue([160, setStoredNumberMock]);
  unitsMock.mockReturnValue({ unitPrefs: { distance: 'km' } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WeekdayEfficiencyChart series role', () => {
  it.each([
    ['cb_safe', CHART_COLORS_CB_SAFE],
    ['neon', CHART_COLORS_NEON],
  ])('uses one saved %s series hue without changing categories, gaps, target or exports', (_id, palette) => {
    paletteMock.mockReturnValue(palette);
    unitsMock.mockReturnValue({
      unitPrefs: { distance: 'km' },
      formatDistance: (value: number) => `${value / 1000} km`,
    });
    const weekdays = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      whPerKm: weekday === 2 ? null : 150 + weekday,
      distanceM: weekday === 2 ? 0 : 10000 + weekday * 1000,
      energyWh: weekday === 2 ? 0 : (150 + weekday) * (10 + weekday),
      drives: weekday === 2 ? 0 : weekday + 1,
    }));
    const rows = weekdays.map((day, index) => ({
      day: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][index],
      consumption: day.whPerKm,
      distanceM: day.distanceM,
      drives: day.drives,
    }));
    const { rerender } = render(<WeekdayEfficiencyChart
      weekdays={weekdays}
      targetWhPerKm={160}
      state={{ isLoading: false, error: null, onRetry: vi.fn() }}
    />);

    expect(weekdayBarMock).toHaveBeenLastCalledWith(expect.objectContaining({
      dataKey: 'consumption',
      name: 'Observed consumption',
      fill: palette[0],
    }));
    expect(weekdayBarMock.mock.lastCall?.[0].children).toBeUndefined();
    expect(weekdayChartMock).toHaveBeenLastCalledWith(expect.objectContaining({ data: rows }));
    expect(weekdayReferenceMock).toHaveBeenLastCalledWith(expect.objectContaining({
      y: 160,
      stroke: palette[5],
      strokeDasharray: '6 4',
    }));
    expect(weekdayContainerMock).toHaveBeenLastCalledWith(expect.objectContaining({
      data: rows,
      exportData: rows,
      exportable: true,
      exportFilename: 'efficiency-target-weekday',
    }));

    const nextPalette = palette === CHART_COLORS_CB_SAFE ? CHART_COLORS_NEON : CHART_COLORS_CB_SAFE;
    paletteMock.mockReturnValue(nextPalette);
    rerender(<WeekdayEfficiencyChart
      weekdays={weekdays}
      targetWhPerKm={160}
      state={{ isLoading: false, error: null, onRetry: vi.fn() }}
    />);
    expect(weekdayBarMock).toHaveBeenLastCalledWith(expect.objectContaining({ fill: nextPalette[0] }));
    expect(weekdayReferenceMock).toHaveBeenLastCalledWith(expect.objectContaining({ y: 160, stroke: nextPalette[5] }));
    expect(weekdayContainerMock).toHaveBeenLastCalledWith(expect.objectContaining({ data: rows, exportData: rows }));
  });
});

describe('RecentWeekScorecard mobile adoption', () => {
  const observers: { element: Element; callback: ResizeObserverCallback }[] = [];
  const weeks: WeekResult[] = Array.from({ length: 10 }, (_, index) => ({
    weekStart: new Date(Date.UTC(2026, 3, 6 + index * 7)).toISOString().slice(0, 10),
    whPerKm: 150 + index,
    distanceM: 10000 + index * 1000,
    energyWh: 1500 + index * 100,
    drives: index,
    isActive: false,
    hit: true,
    band: 'onTarget',
    targetGapWhPerKm: index - 10,
    rolling4WeekWhPerKm: null,
    rank: index + 1,
  }));
  const headers = ['Rank', 'Week', 'Consumption', 'Target gap', 'Distance', 'Drives', 'Status'];
  function resize(width: number) {
    act(() => observers.forEach(({ element, callback }) => callback(
      [{ target: element, contentRect: { width } } as ResizeObserverEntry],
      {} as ResizeObserver,
    )));
  }
  function mount() {
    return render(<RecentWeekScorecard completedWeeks={weeks}
      state={{ isLoading: false, error: null, onRetry: vi.fn() }} />);
  }
  beforeEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    observers.length = 0;
    unitsMock.mockReturnValue({
      unitPrefs: { distance: 'km' },
      formatDistance: (value: number) => `${value / 1000} km`,
    });
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) { observers.push({ element, callback: this.callback }); }
      unobserve() {}
      disconnect() {}
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('data-theme');
  });

  it.each(['light', 'dark'])('preserves all desktop columns and the latest eight weeks in %s mode', (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    mount();
    resize(1280);
    const table = screen.getByRole('table', { name: 'efficiency-target:recent-weeks' });
    for (const header of headers) expect(within(table).getByRole('columnheader', { name: header })).toBeInTheDocument();
    const rows = Array.from(table.querySelectorAll('tbody > tr'));
    expect(rows).toHaveLength(8);
    expect(rows.map(row => row.querySelector('[data-column-key="rank"]')?.textContent))
      .toEqual(['#10', '#9', '#8', '#7', '#6', '#5', '#4', '#3']);
  });

  it.each(['light', 'dark'])('exposes all seven fields through keyboard-operated mobile details in %s mode', async (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    const user = userEvent.setup();
    const view = mount();
    resize(375);
    expect(view.container.querySelector('table')).toBeNull();
    const cards = Array.from(view.container.querySelectorAll<HTMLElement>('[data-card]'));
    expect(cards).toHaveLength(8);
    expect(cards.map(card => card.querySelector('[data-field-key="rank"]')?.textContent))
      .toEqual(['Rank#10', 'Rank#9', 'Rank#8', 'Rank#7', 'Rank#6', 'Rank#5', 'Rank#4', 'Rank#3']);
    const trigger = cards[0];
    trigger.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog');
    for (const header of headers) expect(within(dialog).getByText(header)).toBeInTheDocument();
    expect(within(dialog).getByText('#10')).toBeInTheDocument();
    expect(within(dialog).getByText('19 km')).toBeInTheDocument();
    expect(within(dialog).getByText('9')).toBeInTheDocument();
    expect(within(dialog).getByText('On target')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.keyboard(' ');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close', exact: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: 'Quick view' })).toHaveLength(8);
  });

  it('exports the same eight ordered, seven-field records from desktop and mobile', async () => {
    mount();
    resize(1280);
    const exportRows = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
      await waitFor(() => expect(downloadJSON).toHaveBeenCalled());
      return vi.mocked(downloadJSON).mock.calls.at(-1);
    };
    const desktop = await exportRows();
    expect(desktop?.[0]).toBe('efficiency-target-recent-weeks');
    expect(desktop?.[1]).toHaveLength(8);
    expect(desktop?.[1]).toEqual([10, 9, 8, 7, 6, 5, 4, 3].map(rank => ({
      rank,
      week: expect.any(String),
      consumption: expect.any(String),
      target_gap: expect.any(String),
      distance: `${rank + 9} km`,
      drives: rank - 1,
      status: 'On target',
    })));
    vi.mocked(downloadJSON).mockClear();
    resize(375);
    expect(await exportRows()).toEqual(desktop);
  });
});

describe('EfficiencyTargetPage', () => {
  describe('GoalPulse source trust', () => {
    const rows = () => [
      drive(new Date(2026, 6, 28, 12).toISOString(), 10000, 1500),
      drive(new Date(2026, 7, 4, 12).toISOString(), 10000, 1700),
    ];
    const pulse = (data: Drive[] = rows()) => (
      <GoalPulse
        summary={summarizeTarget(data, 160, Date.now(), { historyLimit: 1000 })}
        state={{ isLoading: false, error: null, onRetry: vi.fn() }}
      />
    );

    beforeEach(() => {
      unitsMock.mockReturnValue({
        unitPrefs: { distance: 'km' },
        formatDistance: (value: number) => `${value / 1000} km`,
      });
    });

    it.each([
      ['active loading', { isLoading: true, isFetching: true }],
      ['paused without data', { fetchStatus: 'paused' }],
    ])('withholds observations during %s', (_name, overrides) => {
      historyMock.mockReturnValue(query({ data: undefined, ...overrides }));
      render(pulse([]));
      const panel = within(screen.getByTestId('efficiency-target-pulse'));
      expect(panel.getByRole('status', { name: 'Loading efficiency target analysis' })).toBeInTheDocument();
      expect(panel.queryByText('Returned evidence')).not.toBeInTheDocument();
      expect(panel.queryByText(/No completed eligible week/)).not.toBeInTheDocument();
      expect(panel.queryByText(/No eligible drives have been observed/)).not.toBeInTheDocument();
    });

    it('renders successful empty history without loading or invented observations', () => {
      render(pulse([]));
      const panel = within(screen.getByTestId('efficiency-target-pulse'));
      expect(panel.getByText('No completed eligible week is available to grade yet.')).toBeInTheDocument();
      expect(panel.getByText('No eligible drives have been observed in the active week.')).toBeInTheDocument();
      expect(panel.queryByRole('status', { name: 'Loading efficiency target analysis' })).not.toBeInTheDocument();
      expect(panel.queryByText('Retained source')).not.toBeInTheDocument();
    });

    it.each([
      ['refresh failure', { isError: true, error: new Error('refresh failed') }],
      ['paused refresh', { fetchStatus: 'paused' }],
    ])('qualifies both retained briefs after %s and restores trust on recovery', (_name, overrides) => {
      const data = rows();
      historyMock.mockReturnValue(query({ data }));
      const { rerender } = render(pulse(data));
      const panel = within(screen.getByTestId('efficiency-target-pulse'));
      expect(panel.getAllByText('Returned evidence')).toHaveLength(2);
      const content = panel.getByText(/150(?:\.0+)? Wh\/km/).textContent;

      historyMock.mockReturnValue(query({ data, ...overrides }));
      rerender(pulse(data));
      expect(panel.getAllByText('Retained source')).toHaveLength(2);
      expect(panel.getByText(/150(?:\.0+)? Wh\/km/)).toHaveTextContent(content ?? '');
      expect(panel.getByText(/170(?:\.0+)? Wh\/km/)).toBeInTheDocument();
      expect(panel.getByText('10 km')).toBeInTheDocument();
      expect(panel.queryByText('Source unavailable')).not.toBeInTheDocument();
      expect(panel.queryByText(/offline/i)).not.toBeInTheDocument();
      expect(historyMock).toHaveBeenLastCalledWith('42', 1000);

      historyMock.mockReturnValue(query({ data, dataUpdatedAt: Date.now() }));
      rerender(pulse(data));
      expect(panel.getAllByText('Returned evidence')).toHaveLength(2);
      expect(panel.queryByText('Retained source')).not.toBeInTheDocument();
    });

    it('keeps observations visible during an active background refresh', () => {
      const data = rows();
      historyMock.mockReturnValue(query({ data, isFetching: true }));
      render(pulse(data));
      const panel = within(screen.getByTestId('efficiency-target-pulse'));
      expect(panel.getAllByText('Returned evidence')).toHaveLength(2);
      expect(panel.getByText(/150(?:\.0+)? Wh\/km/)).toBeInTheDocument();
      expect(panel.getByText(/170(?:\.0+)? Wh\/km/)).toBeInTheDocument();
      expect(panel.queryByText('Loading source')).not.toBeInTheDocument();
    });

    it('preserves explicit zero operands in both returned briefs', () => {
      const data = rows();
      historyMock.mockReturnValue(query({ data }));
      const summary = summarizeTarget(data, 160, Date.now(), { historyLimit: 1000 });
      expect(summary.latestCompletedWeek).not.toBeNull();
      expect(summary.activeWeek).not.toBeNull();
      if (!summary.latestCompletedWeek || !summary.activeWeek) {
        throw new Error('Expected completed and active week fixtures');
      }
      render(
        <GoalPulse
          summary={{
            ...summary,
            latestCompletedWeek: { ...summary.latestCompletedWeek, whPerKm: 0 },
            activeWeek: { ...summary.activeWeek, whPerKm: 0, distanceM: 0, drives: 0 },
          }}
          state={{ isLoading: false, error: null, onRetry: vi.fn() }}
        />,
      );
      const panel = within(screen.getByTestId('efficiency-target-pulse'));
      expect(panel.getAllByText('Returned evidence')).toHaveLength(2);
      expect(panel.getAllByText(/^0(?:\.0+)? Wh\/km$/)).toHaveLength(2);
      expect(panel.getByText('0 km')).toBeInTheDocument();
      expect(panel.getByText(/^0(?:\.0+)?$/)).toBeInTheDocument();
      expect(panel.queryByText('Retained source')).not.toBeInTheDocument();
    });
  });

  it('mounts every workspace section and requests the maximum history window', () => {
    render(<EfficiencyTargetPage />);

    expect(
      screen.getByRole('heading', { name: 'Efficiency Target' }),
    ).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(historyMock).toHaveBeenCalledWith('42', 1000);
    expect(pageTitleMock).toHaveBeenCalledWith('Efficiency Target');
  });

  describe('TargetMethodology source coverage', () => {
    function renderMethodology(rows: Drive[] = []) {
      return render(
        <TargetMethodology
          summary={summarizeTarget(rows, 160, Date.now(), { historyLimit: 1000 })}
          historyLimit={1000}
          state={{ isLoading: false, error: null, onRetry: vi.fn() }}
        />,
      );
    }

    it.each([
      ['pending', query({ data: undefined })],
      ['loading', query({ data: undefined, isLoading: true, isFetching: true })],
      ['paused before first response', query({ data: undefined, fetchStatus: 'paused' })],
      ['initial failure', query({ data: undefined, isError: true, error: new Error('unavailable') })],
    ])('withholds coverage claims for %s while preserving the header and methodology', (_name, result) => {
      historyMock.mockReturnValue(result);
      renderMethodology();
      const panel = within(screen.getByTestId('efficiency-target-method'));
      expect(panel.getByText('Coverage & methodology')).toBeInTheDocument();
      expect(panel.queryByText('Observed window below API cap')).not.toBeInTheDocument();
      expect(panel.queryByText('Rows returned')).not.toBeInTheDocument();
      expect(panel.queryByText(/Results describe/)).not.toBeInTheDocument();
      expect(panel.getAllByRole('listitem')).toHaveLength(5);
      expect(panel.getByText(/Weeks run Monday through Sunday/)).toBeInTheDocument();
      expect(panel.getByText(result.isError ? 'Drive history unavailable' : 'Loading drive history')).toBeInTheDocument();
    });

    it('distinguishes a resolved empty response from missing history and an actual cap', () => {
      renderMethodology();
      const panel = within(screen.getByTestId('efficiency-target-method'));
      expect(panel.getByText('Observed window below API cap')).toBeInTheDocument();
      expect(panel.getAllByText('0')).toHaveLength(3);
      expect(panel.getByText(/Coverage will appear/)).toBeInTheDocument();
      expect(panel.getByText('Results describe the 0 drives returned in this observed history window, up to the 1,000-drive API limit.')).toBeInTheDocument();
      expect(panel.queryByText('1,000-drive cap reached')).not.toBeInTheDocument();
    });

    it.each([
      ['successful', {}],
      ['refreshing', { isFetching: true }],
      ['failed refresh', { isError: true, error: new Error('refresh failed') }],
      ['paused refresh', { fetchStatus: 'paused' }],
    ])('preserves populated coverage and qualifies %s evidence', (_name, overrides) => {
      const rows = [drive(new Date(2026, 6, 28, 12).toISOString(), 10000, 1500)];
      historyMock.mockReturnValue(query({ data: rows, ...overrides }));
      renderMethodology(rows);
      const panel = within(screen.getByTestId('efficiency-target-method'));
      expect(panel.getByText(/Observed window below API cap/)).toBeInTheDocument();
      expect(panel.getByText('1 eligible and 0 excluded across 1 returned rows.')).toBeInTheDocument();
      expect(panel.getAllByRole('listitem')).toHaveLength(5);
      if ('isError' in overrides || 'fetchStatus' in overrides) {
        expect(panel.getByText(/Retained drive history/)).toBeInTheDocument();
      } else {
        expect(panel.queryByText(/Retained drive history/)).not.toBeInTheDocument();
      }
    });

    it('qualifies paused initial history, keeps placeholders and retries without asserting an empty response', () => {
      const refetch = vi.fn();
      historyMock.mockReturnValue(query({
        data: undefined, isPending: true, isLoading: false, fetchStatus: 'paused', refetch,
      }));
      const { rerender } = render(<EfficiencyTargetPage />);

      const notice = screen.getByTestId('efficiency-target-paused');
      expect(notice).toHaveAttribute('role', 'status');
      expect(notice).toHaveTextContent('Refresh paused');
      expect(notice).toHaveTextContent('Drive evidence is not available yet.');
      for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('loading');
      expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText(/offline|No drives with|No completed eligible week/)).not.toBeInTheDocument();
      fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }));
      expect(refetch).toHaveBeenCalledOnce();

      historyMock.mockReturnValue(query({ data: undefined, isPending: true, isLoading: true, isFetching: true, fetchStatus: 'fetching' }));
      rerender(<EfficiencyTargetPage />);
      expect(screen.queryByTestId('efficiency-target-paused')).not.toBeInTheDocument();
      for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('loading');

      historyMock.mockReturnValue(query({ data: [], fetchStatus: 'idle' }));
      rerender(<EfficiencyTargetPage />);
      for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
      expect(screen.getByLabelText('Observed consumption')).toHaveTextContent('unknown');
      expect(screen.getByLabelText('Eligible drives')).toHaveTextContent('0');
      expect(screen.queryByTestId('efficiency-target-paused')).not.toBeInTheDocument();

      historyMock.mockReturnValue(query({
        data: [drive(new Date(2026, 6, 28, 12).toISOString(), 10000, 0)],
      }));
      rerender(<EfficiencyTargetPage />);
      expect(screen.getByLabelText('Observed consumption')).toHaveTextContent(/^0$/);
      expect(screen.getByLabelText('Eligible drives')).toHaveTextContent('1');
    });

    it('preserves the actual cap warning for retained capped history', () => {
      const rows = Array.from({ length: 1000 }, () =>
        drive(new Date(2026, 6, 28, 12).toISOString(), 10000, 1500));
      historyMock.mockReturnValue(query({ data: rows, isError: true, error: new Error('refresh failed') }));
      renderMethodology(rows);
      const panel = within(screen.getByTestId('efficiency-target-method'));
      expect(panel.getByText(/Retained drive history.*1,000-drive cap reached/)).toBeInTheDocument();
      expect(panel.getByText(/older drives may not be represented/)).toBeInTheDocument();
      expect(panel.queryByText(/Observed window below API cap/)).not.toBeInTheDocument();
      expect(panel.getByText('1,000 eligible and 0 excluded across 1,000 returned rows.')).toBeInTheDocument();
    });
  });

  it.each([
    ['loading', query({ data: undefined, isLoading: true })],
    ['error', query({ data: undefined, isError: true, error: new Error('unavailable') })],
  ])('threads the %s state to every mounted section', (expected, result) => {
    historyMock.mockReturnValue(result);
    render(<EfficiencyTargetPage />);

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent(expected);
    }
  });

  it('preserves the no-vehicle recovery state and disables history scope', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    render(<EfficiencyTargetPage />);

    expect(screen.getByTestId('no-vehicle')).toHaveTextContent(
      'Efficiency Target',
    );
    expect(historyMock).toHaveBeenCalledWith(undefined, 1000);
    expect(
      screen.queryByTestId('efficiency-target-weekly'),
    ).not.toBeInTheDocument();
  });

  it('renders miles at the boundary and persists edits back in Wh/km', () => {
    unitsMock.mockReturnValue({ unitPrefs: { distance: 'mi' } });
    render(<EfficiencyTargetPage />);

    const input = screen.getByLabelText('Weekly consumption target');
    expect(input).toHaveValue('257');
    expect(screen.getByText('Wh/mi')).toBeInTheDocument();
    expect(screen.getByTestId('efficiency-target-kpis')).toHaveAttribute(
      'data-target',
      '160',
    );

    fireEvent.change(input, { target: { value: '300' } });
    expect(setStoredNumberMock).toHaveBeenCalledOnce();
    expect(setStoredNumberMock.mock.calls[0]?.[0]).toBeCloseTo(
      300 / 1.609344,
      8,
    );
  });

  it('synchronizes external saved targets and unit changes without persisting a display conversion', () => {
    const { rerender } = render(<EfficiencyTargetPage />);
    const input = screen.getByLabelText('Weekly consumption target');
    expect(input).toHaveValue('160');
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue('');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid number');

    storedNumberMock.mockReturnValue([200, setStoredNumberMock]);
    rerender(<EfficiencyTargetPage />);
    expect(input).toHaveValue('200');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('efficiency-target-weekly')).toHaveAttribute('data-target', '200');

    unitsMock.mockReturnValue({ unitPrefs: { distance: 'mi' } });
    rerender(<EfficiencyTargetPage />);
    expect(input).toHaveValue('322');
    expect(screen.getByText('Wh/mi')).toBeInTheDocument();
    expect(setStoredNumberMock).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'empty draft', text: '' },
    { name: 'zero draft', text: '0' },
    { name: 'negative draft', text: '-5' },
    { name: 'nonfinite draft', text: 'Infinity' },
  ])('retains the saved goal and exposes validation for $name', ({ text }) => {
    render(<EfficiencyTargetPage />);
    const input = screen.getByLabelText('Weekly consumption target');
    fireEvent.change(input, { target: { value: text } });

    expect(input).toHaveValue(text);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid number');
    expect(setStoredNumberMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('efficiency-target-weekly')).toHaveAttribute('data-target', '160');
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
  });

  it('commits a positive target without rounding its canonical goal', () => {
    const { rerender } = render(<EfficiencyTargetPage />);
    const input = screen.getByLabelText('Weekly consumption target');
    fireEvent.change(input, { target: { value: '165.5' } });
    expect(setStoredNumberMock).toHaveBeenCalledWith(165.5);
    storedNumberMock.mockReturnValue([165.5, setStoredNumberMock]);
    rerender(<EfficiencyTargetPage />);
    expect(input).toHaveValue('165.5');
    expect(screen.getByTestId('efficiency-target-weekly')).toHaveAttribute('data-target', '165.5');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps retained source evidence and offers its own retry after a refresh failure', () => {
    const refetch = vi.fn();
    historyMock.mockReturnValue(query({
      data: [drive(new Date(2026, 6, 28, 12).toISOString(), 10000, 1500)],
      isError: true,
      error: new Error('history refresh failed'),
      refetch,
    }));
    const { rerender } = render(<EfficiencyTargetPage />);

    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
    expect(screen.getByLabelText('Observed consumption')).toHaveTextContent('150');
    expect(screen.getByTestId('target-trust')).toHaveAttribute('data-retained', 'true');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledOnce();

    historyMock.mockReturnValue(query({
      data: [drive(new Date(2026, 6, 28, 12).toISOString(), 10000, 1400)],
      dataUpdatedAt: Date.now(),
    }));
    rerender(<EfficiencyTargetPage />);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByTestId('target-trust')).toHaveAttribute('data-retained', 'false');
    expect(screen.getByLabelText('Observed consumption')).toHaveTextContent('140');
  });

  it('keeps paused evidence without inventing a failure or offline vehicle state', () => {
    historyMock.mockReturnValue(query({ fetchStatus: 'paused' }));
    render(<EfficiencyTargetPage />);

    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('Refresh paused');
    expect(screen.getByTestId('target-trust')).toHaveAttribute('data-retained', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Observed consumption')).toHaveTextContent('unknown');
  });

  it('preserves weighted SI evidence and signed target gaps without treating missing measurements as zero', () => {
    historyMock.mockReturnValue(query({
      data: [
        drive(new Date(2026, 6, 28, 12).toISOString(), 10000, 1500),
        drive(new Date(2026, 6, 29, 12).toISOString(), 20000, 3300),
        drive(new Date(2026, 7, 4, 12).toISOString(), 10000, 1700),
        drive(new Date(2026, 7, 5, 12).toISOString(), 10000, null),
      ],
    }));
    render(<EfficiencyTargetPage />);

    expect(screen.getByLabelText('Observed consumption')).toHaveTextContent('162.5');
    expect(screen.getByLabelText('Completed weeks')).toHaveTextContent('1');
    expect(screen.getByLabelText('Active consumption')).toHaveTextContent('170');
    expect(screen.getByLabelText('Completed target gap')).toHaveTextContent('0');
    expect(screen.getByLabelText('Eligible drives')).toHaveTextContent('3');
  });

  it('includes later successful history and completes the active week at the local Monday boundary', () => {
    vi.setSystemTime(new Date(2026, 7, 9, 23, 59));
    const earlier = drive(new Date(2026, 7, 4, 12).toISOString(), 10000, 1500);
    historyMock.mockReturnValue(query({ data: [earlier] }));
    const { rerender } = render(<EfficiencyTargetPage />);
    expect(screen.getByLabelText('Completed weeks')).toHaveTextContent('0');
    expect(screen.getByLabelText('Active consumption')).toHaveTextContent('150');

    act(() => { vi.advanceTimersByTime(60000); });
    expect(screen.getByLabelText('Completed weeks')).toHaveTextContent('1');
    expect(screen.getByLabelText('Active consumption')).toHaveTextContent('unknown');
    expect(screen.getByLabelText('Completed target gap')).toHaveTextContent('-10');

    vi.setSystemTime(new Date(2026, 7, 10, 12));
    historyMock.mockReturnValue(query({
      data: [earlier, drive(new Date(2026, 7, 10, 11).toISOString(), 10000, 1700)],
      dataUpdatedAt: Date.now(),
    }));
    rerender(<EfficiencyTargetPage />);
    expect(screen.getByLabelText('Eligible drives')).toHaveTextContent('2');
    expect(screen.getByLabelText('Active consumption')).toHaveTextContent('170');
  });

  it('contains one widget render failure while preserving the target and neighboring sections', () => {
    pulseRenderMock.mockImplementation(() => { throw new Error('pulse rendering failed'); });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<EfficiencyTargetPage />);
      expect(screen.queryByTestId('efficiency-target-pulse')).not.toBeInTheDocument();
      for (const id of SECTION_IDS.filter((id) => id !== 'efficiency-target-pulse')) {
        expect(screen.getByTestId(id)).toHaveTextContent('ready');
      }
      expect(screen.getByLabelText('Weekly consumption target')).toHaveValue('160');
      expect(screen.getByRole('alert')).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });
});
