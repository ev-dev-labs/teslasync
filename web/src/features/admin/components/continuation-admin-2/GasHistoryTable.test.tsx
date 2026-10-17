import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState } from '@/api/dataState';
import type { GasPriceHistory } from '@/api/types';
import { GasHistoryTable } from './GasHistoryTable';

const observers: { element: Element; callback: ResizeObserverCallback }[] = [];
function resize(width: number) {
  act(() => observers.forEach(({ element, callback }) => callback(
    [{ target: element, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver,
  )));
}
beforeEach(() => {
  localStorage.clear();
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { observers.push({ element, callback: this.callback }); }
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => vi.unstubAllGlobals());

function mount(data: GasPriceHistory[]) {
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
    <GasHistoryTable source={deriveDataState({ data })} />
  </MemoryRouter></QueryClientProvider>);
}

describe('GasHistoryTable', () => {
  it('retains full historical rows after a refresh error and sorts a copy by descending effective date', () => {
    const data: GasPriceHistory[] = [
      { id: 1, price_per_unit: 3.1, unit: 'gal', efficiency_mpg: 25, effective_from: '2026-01-08T00:00:00Z', effective_to: '2026-01-15T00:00:00Z', created_at: '2026-01-08T00:00:00Z' },
      { id: 2, price_per_unit: 3.29, unit: 'gal', efficiency_mpg: 25, effective_from: '2026-01-15T00:00:00Z', effective_to: null, created_at: '2026-01-15T00:00:00Z' },
    ];
    const source = deriveDataState({ data, error: new Error('refresh failed') });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><GasHistoryTable source={source} /></MemoryRouter></QueryClientProvider>);
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('$3.29');
    expect(rows[1]).toHaveTextContent('Current');
    expect(rows[2]).toHaveTextContent('$3.10');
    expect(data.map((item) => item.id)).toEqual([1, 2]);
  });

  it('retains every field in the mobile quick view with keyboard open, close and focus restoration', async () => {
    const user = userEvent.setup();
    mount([{ id: 1, price_per_unit: 3.29, unit: 'gal', efficiency_mpg: 25,
      effective_from: '2026-01-15T00:00:00Z', effective_to: null, created_at: '2026-01-15T00:00:00Z' }]);
    resize(375);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('25.0 mpg')).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Quick view' });
    trigger.focus();
    await user.keyboard('{Enter}');
    const dialog = within(screen.getByRole('dialog'));
    for (const label of ['Effective from', 'Price', 'Unit', 'Efficiency', 'Effective to']) {
      expect(dialog.getByText(label)).toBeInTheDocument();
    }
    expect(dialog.getByText('$3.29/gal')).toBeInTheDocument();
    expect(dialog.getByText('gal')).toBeInTheDocument();
    expect(dialog.getByText('25.0 mpg')).toBeInTheDocument();
    expect(dialog.getByText('Current')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    resize(1200);
    expect(within(screen.getByRole('table', { name: 'Price history' })).getAllByRole('columnheader')).toHaveLength(5);
  });

  it('preserves the current page across desktop/mobile transitions and keeps source order intact', async () => {
    const user = userEvent.setup();
    const data: GasPriceHistory[] = Array.from({ length: 30 }, (_, index) => ({
      id: index + 1, price_per_unit: index + 1, unit: 'gal', efficiency_mpg: 25,
      effective_from: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      effective_to: null, created_at: '2026-01-01T00:00:00Z',
    }));
    mount(data);
    await user.click(screen.getByRole('button', { name: /next page/i }));
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('$5.00');
    resize(375);
    expect(screen.getAllByRole('button', { name: 'Quick view' })).toHaveLength(5);
    expect(screen.getByText('$5.00/gal')).toBeInTheDocument();
    resize(1200);
    expect(within(screen.getByRole('table')).getAllByRole('row')[1]).toHaveTextContent('$5.00');
    expect(data.map(row => row.id)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
  });
});
