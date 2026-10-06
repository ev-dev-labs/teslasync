import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { buildDriveCalendar } from '../../lib/driveCalendar';
import { CalendarSummaryCards } from './CalendarSummaryCards';
import { DriveCalendarHeatmap } from './DriveCalendarHeatmap';
import { MonthlyActivityChart } from './MonthlyActivityChart';
import { WeekdayPatternChart } from './WeekdayPatternChart';
import { RhythmInsightsPanel } from './RhythmInsightsPanel';
import { TopDrivingDaysPanel } from './TopDrivingDaysPanel';

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
    ]) expect(screen.getByRole('heading', { name })).toBeInTheDocument();
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
});
