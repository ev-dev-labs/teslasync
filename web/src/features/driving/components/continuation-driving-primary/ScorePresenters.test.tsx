import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreCategoryCard } from './ScoreCategoryCard';
import { ScorePeriodAverages } from './ScorePeriodAverages';
import { ScoreAchievements } from './ScoreAchievements';
import type { PeriodStats } from '../../pages/DriveScorePage';

describe('ScoreCategoryCard reading preservation', () => {
  it.each([null, Number.NaN, Number.POSITIVE_INFINITY])('does not turn %s into a measured zero', (value) => {
    render(<ScoreCategoryCard title="Efficiency" value={value} max={40} color="var(--theme-primary)"
      icon={null} metricLabel="Average consumption" metricValue="—" />);
    expect(screen.queryByRole('meter', { name: 'Efficiency' })).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Efficiency' })).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByRole('group', { name: 'Efficiency' })).toBeInTheDocument();
    expect(screen.getByText('Average consumption')).toBeInTheDocument();
  });

  it('keeps a measured zero on both accessible quantitative controls', () => {
    render(<ScoreCategoryCard title="Efficiency" value={0} max={40} color="var(--theme-primary)"
      icon={null} metricLabel="Average consumption" metricValue="—" />);
    expect(screen.getByRole('meter', { name: 'Efficiency' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('progressbar', { name: 'Efficiency' })).toHaveAttribute('aria-valuenow', '0');
  });

  it('retains the category title while loading without exposing a fake zero control', () => {
    render(<ScoreCategoryCard title="Efficiency" value={null} max={40} color="var(--theme-primary)"
      icon={null} metricLabel="Average consumption" metricValue="—"
      sourceFallback={<div role="status">Loading category evidence</div>} />);
    expect(screen.getByRole('heading', { name: 'Efficiency' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading category evidence');
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});

describe('ScorePeriodAverages', () => {
  it('retains all six titled shells when the period source is unresolved', () => {
    render(<ScorePeriodAverages stats={null} sourceFallback={<div role="status">Loading period evidence</div>} />);
    for (const label of ['This Week', 'This Month', 'Best Week', 'Best Month', 'Total Drives', 'Rated A+/A']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByRole('status')).toHaveLength(6);
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
  });

  it('preserves all six period facts, measured zero and missing comparisons', () => {
    const stats: PeriodStats = {
      thisWeekAvg: 0, lastWeekAvg: null, thisMonthAvg: null, lastMonthAvg: 0,
      bestWeek: { avg: 0, label: '2026-10-W1' }, bestMonth: { avg: 0, label: '2026-10' },
      totalDrives: 3, aOrBetter: 0,
    };
    render(<ScorePeriodAverages stats={stats} />);
    for (const label of ['This Week', 'This Month', 'Best Week', 'Best Month', 'Total Drives', 'Rated A+/A']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText(/^0$/).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('vs — last week')).toBeInTheDocument();
    expect(screen.getByText('vs 0 last month')).toBeInTheDocument();
    expect(screen.getByText('2026-10-W1')).toBeInTheDocument();
    expect(screen.getByText('2026-10')).toBeInTheDocument();
    expect(screen.getByText('0% of drives')).toBeInTheDocument();
  });
});

describe('ScoreAchievements', () => {
  const items = Array.from({ length: 8 }, (_, index) => ({
    id: `achievement-${index}`, label: `Achievement ${index}`, description: `Evidence ${index}`,
    icon: null, unlocked: index === 0,
  }));

  it('retains every locked and unlocked achievement and its full description', () => {
    render(<ScoreAchievements items={items} sourceFallback={null} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    for (const item of items) {
      expect(screen.getByText(item.label)).toBeInTheDocument();
      expect(screen.getByText(item.description)).toBeInTheDocument();
    }
    expect(screen.getAllByText('Unlocked')).toHaveLength(1);
  });

  it('keeps the panel title while the source is unresolved', () => {
    render(<ScoreAchievements items={items} sourceFallback={<div role="status">Loading evidence</div>} />);
    expect(screen.getByRole('heading', { name: 'Achievements' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading evidence');
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });
});
