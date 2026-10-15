import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import type { PeriodStats } from '../../pages/DriveScorePage';
import { ScorePeriodAverages } from './ScorePeriodAverages';

const preferences = getFormatterPreferences();
afterEach(() => {
  cleanup();
  setGlobalLocale(preferences.locale);
  setGlobalPrecision(preferences.precision);
});

function period(current: number | null, previous: number | null): PeriodStats {
  return {
    thisWeekAvg: current, lastWeekAvg: previous,
    thisMonthAvg: current, lastMonthAvg: previous,
    bestWeek: { avg: 90, label: '2026-W40' },
    bestMonth: { avg: 85, label: '2026-10' },
    totalDrives: 8, aOrBetter: 4,
  };
}

function weekTile() {
  const tile = screen.getByText('This Week').parentElement;
  if (!tile) throw new Error('Missing week tile');
  return within(tile);
}

describe('ScorePeriodAverages directional comparisons', () => {
  it.each([
    [80, 70, 'Increased by 10.00'],
    [70, 80, 'Decreased by 10.00'],
    [-2, -5, 'Increased by 3.00'],
    [-5, -2, 'Decreased by 3.00'],
    [80.75, 80.25, 'Increased by 0.50'],
    [80.25, 80.75, 'Decreased by 0.50'],
    [0, 0, 'No change'],
    [-2.5, -2.5, 'No change'],
  ])('preserves values and explains %s versus %s', (current, previous, text) => {
    setGlobalPrecision(2);
    render(<ScorePeriodAverages stats={period(current, previous)} />);
    expect(weekTile().getByText(String(current), { exact: true })).toBeInTheDocument();
    expect(weekTile().getByText(`vs ${previous} last week`)).toBeInTheDocument();
    expect(screen.getAllByText(text)).toHaveLength(2);
    for (const label of ['This Week', 'This Month', 'Best Week', 'Best Month', 'Total Drives', 'Rated A+/A']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('2026-W40')).toBeInTheDocument();
    expect(screen.getByText('2026-10')).toBeInTheDocument();
    expect(screen.getByText('50% of drives')).toBeInTheDocument();
  });

  it.each([null, Number.NaN, Infinity, -Infinity])('does not compare unavailable %s with zero', (invalid) => {
    render(<ScorePeriodAverages stats={period(invalid, 0)} />);
    expect(weekTile().getByText('—', { exact: true })).toBeInTheDocument();
    expect(weekTile().getByText('vs 0 last week')).toBeInTheDocument();
    expect(screen.queryByText(/Increased by|Decreased by|No change/)).not.toBeInTheDocument();
  });

  it.each([null, Number.NaN, Infinity, -Infinity])('keeps measured zero when previous %s is unavailable', (invalid) => {
    render(<ScorePeriodAverages stats={period(0, invalid)} />);
    expect(weekTile().getByText('0', { exact: true })).toBeInTheDocument();
    expect(weekTile().getByText('vs — last week')).toBeInTheDocument();
    expect(screen.queryByText(/Increased by|Decreased by|No change/)).not.toBeInTheDocument();
  });

  it('handles missing fields independently of measured zero', () => {
    const stats = period(0, 0);
    Reflect.deleteProperty(stats, 'thisWeekAvg');
    Reflect.deleteProperty(stats, 'lastMonthAvg');
    render(<ScorePeriodAverages stats={stats} />);
    expect(weekTile().getByText('—', { exact: true })).toBeInTheDocument();
    expect(weekTile().getByText('vs 0 last week')).toBeInTheDocument();
    expect(screen.getByText('vs — last month')).toBeInTheDocument();
    expect(screen.queryByText('No change')).not.toBeInTheDocument();
  });

  it('uses the numeric locale and does not erase small fractional changes', () => {
    setGlobalLocale('de-DE');
    setGlobalPrecision(0);
    const { rerender } = render(<ScorePeriodAverages stats={period(1.5, 0)} />);
    setGlobalPrecision(2);
    rerender(<ScorePeriodAverages stats={period(1.5, 0)} />);
    expect(screen.getAllByText('Increased by 1,50')).toHaveLength(2);
    rerender(<ScorePeriodAverages stats={period(0.001, 0)} />);
    expect(screen.getAllByText('Increased by 1,00E-3')).toHaveLength(2);
  });

  it('retains all six shells and fallback content without invented measurements', () => {
    render(<ScorePeriodAverages stats={null} sourceFallback={<span role="status">Loading evidence</span>} />);
    expect(screen.getAllByRole('status')).toHaveLength(6);
    expect(screen.queryByText('No change')).not.toBeInTheDocument();
    expect(screen.getByText('This Week')).toBeInTheDocument();
    expect(screen.getByText('Rated A+/A')).toBeInTheDocument();
  });
});
