import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState } from '@/api/dataState';
import type { GasPriceHistory } from '@/api/types';
import { GasHistoryTable } from './GasHistoryTable';

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
});
