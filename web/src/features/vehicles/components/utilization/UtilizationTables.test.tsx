import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { summarizeUtilization, type UtilizationSummary } from '../../lib/utilization';
import { BusiestDays } from './BusiestDays';
import { UtilizationMethodology } from './UtilizationMethodology';

const display = vi.hoisted(() => ({
  formatDay: (day: string) => day,
  formatDistance: vi.fn((meters: number) => `${meters / 1000} km`),
  formatDuration: vi.fn((seconds: number) => `${seconds / 60} min`),
  formatEnergy: vi.fn((wh: number) => `${wh / 1000} kWh`),
}));

vi.mock('./useUtilizationDisplay', () => ({
  useUtilizationDisplay: () => display,
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return text.replace(/{{(\w+)}}/g, (_match, name: string) => String(options?.[name] ?? ''));
    },
    i18n: { language: 'en' },
  }),
}));

const state = { isLoading: false, error: null, onRetry: vi.fn() };

function summary(): UtilizationSummary {
  const empty = summarizeUtilization([], null, {
    rangeStart: '2026-09-01',
    rangeEnd: '2026-09-30',
    asOfMs: Date.parse('2026-10-01T00:00:00Z'),
    historyLimit: 1000,
  });
  return {
    ...empty,
    busiestDays: [
      { day: '2026-09-05', dayStartMs: 0, observedS: 86_400, driveCount: 2, drivingS: 3600, distanceM: 50_000, energyWh: 10_000, active: true },
      { day: '2026-09-04', dayStartMs: 0, observedS: 86_400, driveCount: 1, drivingS: 1800, distanceM: 10_000, energyWh: 0, active: true },
    ],
    accounting: { ...empty.accounting, returnedRows: 3, eligibleRows: 2, invalidTimestampRows: 1, usableDurationRows: 2 },
  };
}

describe('Shared utilization tables', () => {
  it('retains desktop ranking and all mobile fields without claiming a complete filter universe', () => {
    render(<BusiestDays summary={summary()} state={state} />);
    const table = screen.getByRole('table', { name: 'Ranked busiest observed days' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('#1');
    expect(rows[1]).toHaveTextContent('2026-09-05');
    expect(rows[1]).toHaveTextContent('50 km');
    expect(rows[1]).toHaveTextContent('10 kWh');
    expect(rows[2]).toHaveTextContent('—');
    expect(table.closest('.hidden')).toHaveClass('sm:block');
    const mobile = screen.getByRole('list');
    expect(mobile).toHaveClass('sm:hidden');
    expect(within(mobile).getAllByRole('listitem')).toHaveLength(2);
    expect(within(mobile).getByText('50 km')).toBeInTheDocument();
    expect(display.formatDistance).toHaveBeenCalledWith(50_000);
    expect(display.formatEnergy).toHaveBeenCalledWith(10_000);
    expect(within(table).queryByRole('button', { name: /filter/i })).not.toBeInTheDocument();
  });

  it('retains timestamp and field accounting, zero counts, and methodology notes', () => {
    render(<UtilizationMethodology summary={summary()} historyLimit={1000} state={state} />);
    const exclusions = screen.getByRole('table', { name: 'Timestamp eligibility' });
    expect(within(exclusions).getAllByRole('rowheader')).toHaveLength(4);
    const invalid = within(exclusions).getByRole('rowheader', { name: 'Invalid or missing timestamp' }).closest('tr')!;
    expect(within(invalid).getByRole('cell')).toHaveTextContent('1');
    const future = within(exclusions).getByRole('rowheader', { name: 'At or after frozen as-of time' }).closest('tr')!;
    expect(within(future).getByRole('cell')).toHaveTextContent('0');
    const coverage = screen.getByRole('table', { name: 'Metric field coverage' });
    expect(within(coverage).getAllByRole('rowheader')).toHaveLength(3);
    expect(coverage).toHaveTextContent('2 usable · 0 excluded');
    expect(screen.getByRole('list')).toHaveTextContent('display units are applied only while rendering');
  });

  it('keeps the ranked section shell while loading', () => {
    render(<BusiestDays summary={summary()} state={{ ...state, isLoading: true }} />);
    expect(screen.getByTestId('utilization-busiest')).toHaveTextContent('Busiest observed days');
    expect(screen.getByRole('status', { name: 'Loading utilization analysis' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
