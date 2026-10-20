import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHART_COLORS_CB_SAFE, CHART_COLORS_NEON } from '@/lib/colors';
import { typography } from '@/lib/tokens';
import { getFormatterPreferences, setGlobalLocale } from '@/lib/numberFormat';
import { buildDrivingRhythm } from '../../lib/drivingRhythm';
import { WeeklyPunchcard } from './WeeklyPunchcard';
import type { DrivingRhythmSectionState } from './types';

const preference = vi.hoisted(() => ({ neon: false }));

vi.mock('@/hooks/useChartPalette', async () => {
  const colors = await vi.importActual<typeof import('@/lib/colors')>('@/lib/colors');
  return {
    useChartPalette: () =>
      preference.neon ? colors.CHART_COLORS_NEON : colors.CHART_COLORS_CB_SAFE,
  };
});

const ready: DrivingRhythmSectionState = {
  isLoading: false,
  retained: false,
  error: null,
  onRetry: vi.fn(),
};

function populatedSummary() {
  const summary = buildDrivingRhythm([], { timeZone: 'UTC' });
  summary.matrix[1] = [0, 1, 2, 3, 4, 5, ...Array<number>(18).fill(0)];
  summary.matrix[0]![23] = 2;
  summary.total = 17;
  summary.maxCount = 5;
  summary.favorite = { day: 1, hour: 5, count: 5 };
  return summary;
}

afterEach(() => {
  cleanup();
  preference.neon = false;
});

describe('WeeklyPunchcard', () => {
  it('uses neutral chrome and five ordered palette intensities without changing raw counts', () => {
    const summary = populatedSummary();
    const originalMatrix = structuredClone(summary.matrix);
    const view = render(
      <MemoryRouter>
        <WeeklyPunchcard summary={summary} state={ready} />
      </MemoryRouter>,
    );
    const panel = screen.getByRole('region', { name: 'Weekly punchcard' });
    expect(panel.querySelector('.lucide-calendar-clock')).toHaveClass(typography.color.secondary);
    expect(screen.getByRole('table')).toHaveAccessibleName(
      'Drive starts by local weekday and hour; strongest slot Mon 05:00',
    );
    expect(screen.getByText('24-hour departures grouped in UTC')).toBeInTheDocument();
    const cells = within(panel).getAllByRole('cell');
    expect(cells).toHaveLength(168);
    expect(cells[0]).toHaveAccessibleName('Mon 00:00 · 0 drives');
    expect(cells[167]).toHaveAccessibleName('Sun 23:00 · 2 drives');
    expect(cells[0]!.style.backgroundColor).toBe('');
    expect(cells[0]).toHaveClass('bg-[var(--surface-2)]');
    const levels = [15, 30, 45, 65, 85];
    levels.forEach((percent, index) => {
      expect(cells[index + 1]).toHaveStyle({
        backgroundColor: `color-mix(in srgb, ${CHART_COLORS_CB_SAFE[0]} ${percent}%, var(--surface-2))`,
      });
      expect(cells[index + 1]).toHaveAccessibleName(`Mon 0${index + 1}:00 · ${index + 1} drives`);
    });

    preference.neon = true;
    view.rerender(
      <MemoryRouter>
        <WeeklyPunchcard summary={summary} state={ready} />
      </MemoryRouter>,
    );
    levels.forEach((percent, index) => {
      expect(cells[index + 1]).toHaveStyle({
        backgroundColor: `color-mix(in srgb, ${CHART_COLORS_NEON[0]} ${percent}%, var(--surface-2))`,
      });
    });
    expect(summary.matrix).toEqual(originalMatrix);
    expect(preference.neon).toBe(true);
  });

    it('exposes every weekday/hour/count to touch and keyboard in a contained semantic table', () => {
      const summary = populatedSummary();
      render(<MemoryRouter><WeeklyPunchcard summary={summary} state={ready} /></MemoryRouter>);
      const region = screen.getByRole('region', {
        name: 'Weekly drive-start counts; scroll to see all hours',
      });
      expect(region).toHaveAttribute('tabindex', '0');
      expect(region).toHaveClass('max-w-full', 'overflow-x-auto', 'overscroll-x-contain');
      region.focus();
      expect(region).toHaveFocus();
      const table = within(region).getByRole('table');
      expect(table.closest('[data-table-variant]')).toHaveAttribute('data-table-variant', 'embedded');
      expect(within(table).getAllByRole('columnheader')).toHaveLength(25);
      const rows = within(table).getAllByRole('row').slice(1);
      expect(rows).toHaveLength(7);
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const order = [1, 2, 3, 4, 5, 6, 0];
      rows.forEach((row, index) => {
        expect(within(row).getByRole('rowheader', { name: days[index] })).toHaveAttribute('scope', 'row');
        const cells = within(row).getAllByRole('cell');
        expect(cells).toHaveLength(24);
        cells.forEach((cell, hour) => {
          const count = summary.matrix[order[index]!]![hour]!;
          expect(cell.textContent).toBe(String(count));
          expect(cell).toHaveAccessibleName(`${days[index]} ${String(hour).padStart(2, '0')}:00 · ${count} drives`);
          expect(cell).not.toHaveAttribute('title');
          expect(cell).toBeVisible();
        });
      });
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('localizes numeric hours and counts using the current formatting preference', () => {
      const previousLocale = getFormatterPreferences().locale;
      setGlobalLocale('ar-EG');
      try {
        render(<MemoryRouter><WeeklyPunchcard summary={populatedSummary()} state={ready} /></MemoryRouter>);
        expect(screen.getByRole('columnheader', { name: '٠٥' })).toBeInTheDocument();
        expect(screen.getByRole('cell', { name: 'Mon ٠٥:٠٠ · ٥ drives' })).toHaveTextContent('٥');
        expect(screen.getByRole('table')).toHaveAccessibleName(
          'Drive starts by local weekday and hour; strongest slot Mon ٠٥:٠٠',
        );
      } finally {
        setGlobalLocale(previousLocale);
      }
    });

  it('keeps the empty shell and browse action', () => {
    render(
      <MemoryRouter>
        <WeeklyPunchcard summary={buildDrivingRhythm([], { timeZone: 'UTC' })} state={ready} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('region', { name: 'Weekly punchcard' })).toBeInTheDocument();
    expect(screen.getByText('No drives in this period yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse drives' })).toHaveAttribute('href', '/drives');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('preserves loading behavior with populated evidence', () => {
    render(
      <MemoryRouter>
        <WeeklyPunchcard summary={populatedSummary()} state={{ ...ready, isLoading: true }} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('region', { name: 'Weekly punchcard' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading driving rhythm evidence' })).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
