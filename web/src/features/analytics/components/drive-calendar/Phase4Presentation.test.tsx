import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Children, isValidElement, type ComponentProps, type ReactNode } from 'react';
import { ChartCard } from '@/components/layout';
import { Bar, ChartTooltip, ComposedChart, Line, YAxis } from '@/components/charts';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import type { Drive } from '@/types/driving';
import { buildDriveCalendar } from '../../lib/driveCalendar';
import { CalendarSummaryCards } from './CalendarSummaryCards';
import { DriveCalendarHeatmap } from './DriveCalendarHeatmap';
import { MonthlyActivityChart } from './MonthlyActivityChart';
import { WeekdayPatternChart } from './WeekdayPatternChart';
import { RhythmInsightsPanel } from './RhythmInsightsPanel';
import { TopDrivingDaysPanel } from './TopDrivingDaysPanel';
import englishCatalog from '@/i18n/en.json';

const { chartCardMock, summaryTranslation } = vi.hoisted(() => ({
  chartCardMock: vi.fn(),
  summaryTranslation: vi.fn<(key: string, fallback: string, values?: Record<string, unknown>) => string>(),
}));
vi.mock('@/components/layout', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/components/layout')>();
  return {
    ...original,
    ChartCard: (props: ComponentProps<typeof ChartCard>) => {
      chartCardMock(props);
      return <original.ChartCard {...props} />;
    },
  };
});

function chartElement(node: ReactNode, type: unknown): Record<string, unknown> {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (child.type === type) return child.props;
    const found = chartElement(child.props.children, type);
    if (Object.keys(found).length) return found;
  }
  return {};
}

const initialPreferences = getFormatterPreferences();
afterEach(() => {
  setGlobalPrecision(initialPreferences.precision);
  setGlobalLocale(initialPreferences.locale);
  summaryTranslation.mockReset();
});

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
      energy: 'kWh', duration: 'h', power: 'kW', precision: 1, locale: 'en-US' },
    formatDistance: (raw: number) => `${(raw / 1000).toFixed(1)} km`,
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) =>
      summaryTranslation.getMockImplementation() && ['driveCalendar.days', 'driveCalendar.driveCount'].includes(key)
        ? summaryTranslation(key, typeof fallback === 'string' ? fallback : key, values)
        : (typeof fallback === 'string' ? fallback : key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? `{{${name}}}`)),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const calendar = buildDriveCalendar([], new Date('2026-07-01T12:00:00').getTime(), {
  start: '2026-01-01', end: '2026-06-30',
});

function show(isLoading = false, error: Error | null = null) {
  const state = { isLoading, error, onRetry: vi.fn() };
  return render(<MemoryRouter>
    <CalendarSummaryCards calendar={calendar} rangeEnd="2026-06-30" {...state} />
    <DriveCalendarHeatmap calendar={calendar} {...state} />
    <MonthlyActivityChart months={calendar.months} {...state} />
    <WeekdayPatternChart weekdays={calendar.weekdays} {...state} />
    <RhythmInsightsPanel calendar={calendar} {...state} />
    <TopDrivingDaysPanel days={calendar.topDays} {...state} />
  </MemoryRouter>);
}

describe('canonical calendar frames preserve independent source bodies', () => {
  it.each([
    { streak: 0, drives: 0, daysLabel: '0 days', drivesLabel: '0 drives' },
    { streak: 1, drives: 2, daysLabel: '1 day', drivesLabel: '2 drives' },
    { streak: 2, drives: 1, daysLabel: '2 days', drivesLabel: '1 drive' },
  ])('pluralizes summary counts independently: $daysLabel, $drivesLabel', async ({
    streak, drives, daysLabel, drivesLabel,
  }) => {
    const { createInstance } = await import('i18next');
    for (const resources of [{ en: { translation: englishCatalog } }, {}]) {
      const translations = createInstance();
      await translations.init({ lng: 'en', resources, interpolation: { escapeValue: false } });
      summaryTranslation.mockImplementation((key, fallback, values) =>
        translations.t(key, { ...values, defaultValue: fallback }));
      const { container, unmount } = render(<MemoryRouter>
        <CalendarSummaryCards calendar={{ ...calendar, currentStreak: streak, totalDrives: drives }}
          rangeEnd="2026-06-30" isLoading={false} error={null} onRetry={vi.fn()} />
      </MemoryRouter>);
      const streakMetric = container.querySelector('[data-operational-metric="calendar-streak"]');
      expect(streakMetric).toHaveTextContent(daysLabel);
      expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(3);
      fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
      const pluralDialog = screen.getByRole('dialog');
      expect(within(pluralDialog).getByText(drivesLabel)).toBeInTheDocument();
      expect(within(pluralDialog).getByText('longest: 0')).toBeInTheDocument();
      expect(within(pluralDialog).queryByRole('group', { name: 'Busiest day' })).not.toBeInTheDocument();
      expect(within(pluralDialog).getByText(/^1 empty fields? (is|are) hidden\.$/)).toBeInTheDocument();
      fireEvent.keyDown(pluralDialog, { key: 'Escape' });
      unmount();
    }
  });

  it('keeps full-precision monthly rows and applies live numeric preferences only at presentation', () => {
    setGlobalPrecision(3);
    setGlobalLocale('de-DE');
    const months = [1234.567, -1234.567, 0, NaN, Infinity, -Infinity].map((distanceM) => ({
      month: '2026-06', distanceM, drives: 1234, activeDays: 2, totalDays: 30,
    }));
    // Simulate malformed wire inputs without widening the canonical source type.
    const missing = { month: '2026-06', drives: 1, activeDays: 1, totalDays: 30 };
    months.push(JSON.parse(JSON.stringify(missing)), JSON.parse(JSON.stringify({ ...missing, distanceM: null })));
    render(<MemoryRouter>
      <MonthlyActivityChart months={months} isLoading={false} error={null} onRetry={vi.fn()} />
    </MemoryRouter>);

    const readChart = () => {
      const props: ComponentProps<typeof ChartCard> = chartCardMock.mock.lastCall![0];
      expect(props.chartKey).toBe('drive-calendar-monthly');
      expect(props.exportFilename).toBe('drive-calendar-monthly');
      expect(props.exportable).toBe(true);
      if (typeof props.children !== 'function') throw new Error('Expected chart render function');
      const tree = props.children({ hiddenSeries: undefined });
      return { props, tree };
    };
    const { props, tree } = readChart();
    expect(props.data?.map(row => row.distance)).toEqual([
      1.234567, -1.234567, 0, null, null, null, null, null,
    ]);
    expect(months[0]?.distanceM).toBe(1234.567);
    expect(months[1]?.distanceM).toBe(-1234.567);
    expect(chartElement(tree, ComposedChart).data).toEqual(props.data);
    expect(chartElement(tree, Bar)).toMatchObject({ dataKey: 'distance', yAxisId: 'distance' });
    expect(chartElement(tree, Line)).toMatchObject({ dataKey: 'drives', yAxisId: 'drives' });
    expect(props.dataColumns?.map(column => column.key)).toEqual(['month', 'distance', 'drives', 'activeDays']);
    const distanceFormat = props.dataColumns?.find(column => column.key === 'distance')?.format;
    expect(distanceFormat?.(1.234567)).toBe('1,235');
    expect(distanceFormat?.(-1.234567)).toBe('-1,235');
    expect(distanceFormat?.(0)).toBe('0,000');
    for (const value of [null, undefined, NaN, Infinity, -Infinity]) {
      expect(distanceFormat?.(value)).toBe('—');
    }
    const axis = chartElement(tree, YAxis).tickFormatter;
    if (typeof axis !== 'function') throw new Error('Expected distance axis formatter');
    expect(axis(1.234567)).toBe('1,235');
    const tooltip = chartElement(tree, ChartTooltip).valueFormatter;
    // The tooltip element is passed as Tooltip.content, not a rendered child.
    expect(tooltip).toBeUndefined();

    act(() => { setGlobalPrecision(5); setGlobalLocale('en-US'); });
    const updated = readChart().props;
    expect(updated.data).toBe(props.data);
    expect(updated.dataColumns?.find(column => column.key === 'distance')?.format?.(1.234567))
      .toBe('1.23457');
  });

  it('lets keyboard and touch users disclose every daily value without replacing the heatmap', async () => {
    const user = userEvent.setup();
    const drive: Drive = {
      id: 1, vehicleId: 1, startTs: '2026-06-29T12:00:00', endTs: null,
      durationS: 600, distanceM: 6250, startAddress: null, endAddress: null,
      startLat: null, startLon: null, endLat: null, endLon: null,
      startBatteryPct: null, endBatteryPct: null, energyUsedWh: null,
      regenEnergyWh: null, avgSpeedMps: null, maxSpeedMps: null, avgPowerW: null,
      outsideTempAvgC: null, insideTempAvgC: null, score: null, endedStatus: null,
      createdAt: '2026-06-29T12:00:00', updatedAt: '2026-06-29T12:00:00',
    };
    const populated = buildDriveCalendar([drive, { ...drive, id: 2 }],
      new Date('2026-07-01T12:00:00').getTime(), {
      start: '2026-06-28', end: '2026-06-30',
    });
    const { container } = render(<MemoryRouter>
      <DriveCalendarHeatmap calendar={populated} isLoading={false} error={null} onRetry={vi.fn()} />
    </MemoryRouter>);

    const heatmap = screen.getByRole('img', { name: /Daily driving heatmap/ });
    expect(within(heatmap).getByTitle('Jun 29, 2026 · 12.5 km · 2 drives')).toBeInTheDocument();
    expect(heatmap.querySelectorAll('[title]')).toHaveLength(
      populated.weeks.reduce((count, week) => count + week.days.length, 0),
    );
    expect(screen.getByText('1 active days · 2 drives')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'View details' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const table = screen.getByRole('table', { name: 'Driving activity' });
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent))
      .toEqual(['Date', 'Distance', 'Drives']);
    expect(within(table).getAllByRole('row')).toHaveLength(populated.days.length + 1);
    for (const [date, distance, count] of [
      ['Jun 28, 2026', '0.0 km', '0'],
      ['Jun 29, 2026', '12.5 km', '2'],
      ['Jun 30, 2026', '0.0 km', '0'],
    ]) {
      const row = within(table).getByRole('rowheader', { name: date }).closest('tr')!;
      expect(within(row).getAllByRole('cell').map(cell => cell.textContent)).toEqual([distance, count]);
    }
    expect(heatmap).toBeInTheDocument();
    expect(container.querySelector('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])')).toBeNull();
    await user.keyboard(' ');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.pointer({ keys: '[TouchA]', target: trigger });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('table', { name: 'Driving activity' })).toBeInTheDocument();
  });

  it.each(['loading', 'fatal', 'empty'] as const)('keeps all six named surfaces while %s', state => {
    const { container } = show(state === 'loading', state === 'fatal' ? new Error('failed') : null);
    for (const name of [
      'Drive calendar summary metrics', 'Selected period', 'Monthly distance & activity',
      'Day-of-week pattern', 'Driving rhythm', 'Top driving days',
    ]) {
      // Card titles and the summary strip are separate from chart accessibility titles.
      const headings = screen.getAllByRole('heading', { name })
        .filter(heading => heading.hasAttribute('data-card-title')
          || heading.closest('#drive-calendar-summary') != null);
      expect(headings).toHaveLength(1);
      expect(headings[0]).toBeInTheDocument();
    }
    expect(container.querySelectorAll('[data-card]')).toHaveLength(5);
    const summary = container.querySelector('#drive-calendar-summary');
    expect(summary).not.toBeNull();
    if (state === 'fatal') {
      expect(within(summary as HTMLElement).queryByText('0')).not.toBeInTheDocument();
      expect(within(summary as HTMLElement).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    }
    if (state === 'empty') {
      expect(screen.getAllByText('No drives in the selected period.')).toHaveLength(2);
      expect(screen.getByText('No active driving days to rank yet.')).toBeInTheDocument();
      expect(screen.getByText('No driving rhythm to summarize yet.')).toBeInTheDocument();
    }
  });

  it('retains the four raw metrics, coverage caption and real review drawer', () => {
    const { container } = render(<MemoryRouter>
      <CalendarSummaryCards calendar={calendar} rangeEnd="2026-06-30" retained
        isLoading={false} error={null} onRetry={vi.fn()}
        period={{ kind: 'analysis', label: '2026-01-01 – 2026-06-30',
          start: '2026-01-01T00:00:00Z', endExclusive: '2026-07-01T00:00:00Z',
          timezone: 'UTC', completeness: 'unknown',
          provenance: 'Returned drives in the selected workspace range; continuous coverage is unknown.' }} />
    </MemoryRouter>);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(3);
    expect(container.querySelector('[data-operational-metric="calendar-active-days"]'))
      .toHaveAttribute('data-value-state', 'value');
    expect(container.querySelector('[data-operational-metric="calendar-busiest-day"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'Browse drives' })).toHaveAttribute('href', '/drives');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const coverageDialog = screen.getByRole('dialog');
    expect(within(coverageDialog).getByText('Retained drive history')).toBeInTheDocument();
    const coverageHeader = coverageDialog.querySelector('[data-drawer-header]');
    expect(coverageHeader).not.toBeNull();
    expect(within(coverageHeader as HTMLElement).getByText('Returned drives in the selected workspace range; continuous coverage is unknown.'))
      .toBeInTheDocument();
    expect(within(within(coverageDialog).getByTestId('calculation-details'))
      .getByText('Returned drives in the selected workspace range; continuous coverage is unknown.')).toBeInTheDocument();
    expect(within(coverageDialog).getByText('Drive calendar summary metrics details')).toBeInTheDocument();
    expect(within(coverageDialog).queryByRole('group', { name: 'Busiest day' })).not.toBeInTheDocument();
    expect(within(coverageDialog).getByText(/^1 empty fields? (is|are) hidden\.$/)).toBeInTheDocument();
    fireEvent.keyDown(coverageDialog, { key: 'Escape' });
  });

  it('exposes busy state without presenting loading values as measured zero', () => {
    const { container } = show(true);
    const brief = container.querySelector('[data-operational-brief]');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(brief?.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(brief?.querySelectorAll('[data-value-state="missing"]')).toHaveLength(4);
  });
});
