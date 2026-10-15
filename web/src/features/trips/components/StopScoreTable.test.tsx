import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  afterEach(() => vi.unstubAllGlobals());

  it('keeps source order and all stop fields accessible through keyboard-operated mobile details', async () => {
    const observers: { element: Element; callback: ResizeObserverCallback }[] = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) { observers.push({ element, callback: this.callback }); }
      unobserve() {}
      disconnect() {}
    });
    const user = userEvent.setup();
    renderTable([
      { site: 'First stop', score: 25, wait_s: null, unit_price: null, health: null,
        corridor_m: 100, evidence: ['first evidence', 'second evidence'] },
      { site: 'Second stop', score: 90, wait_s: 0, unit_price: 0, health: 0,
        corridor_m: 200, evidence: ['last evidence'] },
    ]);
    const resize = (width: number) => act(() => observers.forEach(({ element, callback }) => callback(
      [{ target: element, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver,
    )));
    resize(375);
    const cards = screen.getAllByRole('button').filter(button => button.hasAttribute('data-card'));
    expect(cards.map(card => card.getAttribute('aria-label'))).toEqual(['First stop', 'Second stop']);
    cards[0].focus();
    await user.keyboard(' ');
    const dialog = screen.getByRole('dialog', { name: 'First stop' });
    for (const label of ['Stop', 'Score', 'Wait', '$/kWh', 'Health', 'Off route']) {
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    }
    expect(within(dialog).getByText('first evidence')).toBeInTheDocument();
    expect(within(dialog).getByText('second evidence')).toBeInTheDocument();
    expect(within(dialog).getAllByText('—')).toHaveLength(3);
    expect(within(dialog).getByText('100 m')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(cards[0]).toHaveFocus();
    await user.click(screen.getAllByRole('button', { name: 'Quick view' })[1]);
    expect(within(screen.getByRole('dialog', { name: 'Second stop' })).getByText('$0.00')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    resize(1200);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('last evidence')).toBeInTheDocument();
  });

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
