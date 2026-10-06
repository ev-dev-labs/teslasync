import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ScoredStop } from '@/api/hooks/useJourney';
import { StopScoreTable } from './StopScoreTable';

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatDistance: (m: number) => `${m} m` }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ formatCurrency: (amount: number) => `$${amount.toFixed(2)}` }),
}));

function renderTable(stops: ScoredStop[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StopScoreTable stops={stops} tableId="journey-stop-scores-preservation" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StopScoreTable', () => {
  it('keeps complete evidence, source ordering, nullable details and a named passive score track', () => {
    const stops: ScoredStop[] = [
      { site: 'Supplied first', score: 25, wait_s: null, unit_price: null, health: null,
        corridor_m: 100, evidence: ['first evidence', 'second evidence'] },
      { site: 'Supplied second', score: 90, wait_s: 0, unit_price: 0, health: 0,
        corridor_m: 200, evidence: ['last evidence'] },
    ];
    renderTable(stops);
    expect(screen.getByText('first evidence')).toBeInTheDocument();
    expect(screen.getByText('second evidence')).toBeInTheDocument();
    expect(screen.getByText('last evidence')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('$0.00')).toBeInTheDocument();
    expect(screen.getByText('100 m')).toBeInTheDocument();
    expect(screen.getByText('200 m')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Score for Supplied first' }))
      .toHaveAttribute('aria-valuenow', '25');
    const rows = screen.getAllByRole('row');
    expect(rows.findIndex(row => row.textContent?.includes('Supplied first')))
      .toBeLessThan(rows.findIndex(row => row.textContent?.includes('Supplied second')));
  });

  it('clamps only the visual score track, keeping the original scored value visible', () => {
    renderTable([
      { site: 'High score', score: 120, wait_s: null, unit_price: null, health: null,
        corridor_m: 0, evidence: [] },
    ]);
    expect(screen.getByRole('progressbar', { name: 'Score for High score' }))
      .toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('120.00')).toBeInTheDocument();
  });
});
