import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { buildDriveCalendar } from '../../lib/driveCalendar';
import { CalendarSummaryCards } from './CalendarSummaryCards';
import { DriveCalendarHeatmap } from './DriveCalendarHeatmap';
import { MonthlyActivityChart } from './MonthlyActivityChart';
import { WeekdayPatternChart } from './WeekdayPatternChart';
import { RhythmInsightsPanel } from './RhythmInsightsPanel';
import { TopDrivingDaysPanel } from './TopDrivingDaysPanel';

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
      (typeof fallback === 'string' ? fallback : key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? `{{${name}}}`)),
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
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(container.querySelector('[data-operational-metric="calendar-active-days"]'))
      .toHaveAttribute('data-value-state', 'value');
    expect(container.querySelector('[data-operational-metric="calendar-busiest-day"]'))
      .toHaveAttribute('data-value-state', 'missing');
    expect(screen.getByText('Retained drive history')).toBeInTheDocument();
    expect(screen.getByText('Returned drives in the selected workspace range; continuous coverage is unknown.'))
      .toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse drives' })).toHaveAttribute('href', '/drives');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('Drive calendar summary metrics details')).toBeInTheDocument();
  });

  it('exposes busy state without presenting loading values as measured zero', () => {
    const { container } = show(true);
    const brief = container.querySelector('[data-operational-brief]');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(brief?.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(brief?.querySelectorAll('[data-value-state="missing"]')).toHaveLength(4);
  });
});
