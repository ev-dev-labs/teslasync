import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState } from '@/api/dataState';
import type { Drive } from '@/types/driving';
import { MileageBudgetSummary } from './MileageBudgetSummary';
import { computeMileageBudget } from '../lib/mileageBudget';

const config = { annualAllowanceKm: 12_000, termStartIso: '2026-01-01', termMonths: 12, overagePerKm: 0.25 };
const period = { kind: 'event' as const, eventId: 'mileage-budget:2026-01-01', start: config.termStartIso,
  end: null, provenance: 'Configured term; observed drive-history coverage may be incomplete.',
  label: 'Term starting 2026-01-01 · 12 months' };
const budget = computeMileageBudget([], config, new Date('2026-06-01T00:00:00Z').getTime());
const formatDistance = (m: number) => `${m} m`;
const formatCurrency = (value: number) => `$${value}`;

describe('phase 4 allowance summary source and cap preservation', () => {
  it('withholds all cap-sensitive forecasts, while retaining observed distance and the calibration period', () => {
    const source = deriveDataState<Drive[]>({ data: [] }, { provenance: 'historical' });
    const { container } = render(<MemoryRouter><MileageBudgetSummary
      budget={{ ...budget, historyCapReached: true, usedM: 123_456, projectedTotalM: 999_999,
        projectedOverageM: 987_999, projectedOverageCost: 246.999 }}
      source={source} period={period} formatDistance={formatDistance} formatCurrency={formatCurrency}
    /></MemoryRouter>);
    expect(screen.getByText('123456 m')).toBeInTheDocument();
    expect(screen.getAllByText('unavailable while history is capped')).toHaveLength(3);
    expect(screen.getByText('Term starting 2026-01-01 · 12 months')).toBeInTheDocument();
    expect(screen.queryByText('999999 m')).not.toBeInTheDocument();
    expect(screen.queryByText('$246.999')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-stat-value]')).toHaveLength(4);
  });

  it('retains usable operands on refresh failure, without changing the model or source', () => {
    const source = deriveDataState<Drive[]>({ data: [], error: new Error('refresh failed') });
    const before = JSON.stringify(budget);
    render(<MemoryRouter><MileageBudgetSummary budget={budget} source={source} period={period}
      formatDistance={formatDistance} formatCurrency={formatCurrency} /></MemoryRouter>);
    expect(screen.getByText('Showing retained measurements')).toBeInTheDocument();
    expect(screen.getAllByText('0 m').length).toBeGreaterThan(0);
    expect(screen.getByText('$0')).toBeInTheDocument();
    expect(JSON.stringify(budget)).toBe(before);
  });

  it('initial failure keeps four unknown readings and the retry instead of fabricated zeros', () => {
    const retry = vi.fn();
    const source = deriveDataState<Drive[]>({ error: new Error('failed'), refetch: retry });
    const { container } = render(<MemoryRouter><MileageBudgetSummary budget={budget} source={source}
      period={period} formatDistance={formatDistance} formatCurrency={formatCurrency} /></MemoryRouter>);
    expect(container.querySelectorAll('[data-stat-value]')).toHaveLength(4);
    expect(screen.queryByText('0 m')).not.toBeInTheDocument();
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
    expect(screen.queryByText('within budget pace')).not.toBeInTheDocument();
    expect(screen.queryByText('no overage projected')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
