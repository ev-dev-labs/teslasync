import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { analyzePackCapacity } from '../../lib/packCapacity';
import { PackCapacitySocWindowProfile } from './PackCapacitySocWindowProfile';
import type { PackCapacityQueryState } from './types';

vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotations: () => ({ data: [], isPending: false, isLoading: false, isFetching: false, isError: false, error: null, fetchStatus: 'idle', dataUpdatedAt: 0, refetch: vi.fn() }),
  useChartAnnotationsAsData: () => ({ annotations: [] }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
  useDeleteAnnotation: () => ({ mutate: vi.fn() }),
}));

const now = Date.parse('2026-10-14T12:00:00Z');
const emptyResult = analyzePackCapacity([], now, 'UTC');
const populatedResult = analyzePackCapacity([{
  id: '1',
  vehicle_id: '7',
  charger_type: 'AC',
  start_soc_pct: 20,
  end_soc_pct: 60,
  total_energy_added_wh: 30_000,
  peak_power_w: 11_000,
  cost_decimal: null,
  started_at: '2026-10-13T10:00:00Z',
  ended_at: '2026-10-13T12:00:00Z',
  start_ts: '2026-10-13T10:00:00Z',
  startedAt: '2026-10-13T10:00:00Z',
  duration_min: 120,
}], now, 'UTC');

function source(overrides: Partial<PackCapacityQueryState> = {}): PackCapacityQueryState {
  return {
    vehicleSelected: true,
    isLoading: false,
    isResolved: true,
    error: null,
    refreshError: null,
    onRetry: vi.fn(),
    ...overrides,
  };
}

function mount(state: PackCapacityQueryState, result = emptyResult) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (nextState: PackCapacityQueryState, nextResult = result) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackCapacitySocWindowProfile result={nextResult} state={nextState} energyUnit="kWh" />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(state));
  return {
    ...view,
    update: (nextState: PackCapacityQueryState, nextResult = result) =>
      view.rerender(tree(nextState, nextResult)),
  };
}

describe('PackCapacitySocWindowProfile source-aware accessible data', () => {
  it.each([
    ['active loading', source({ isLoading: true, isResolved: false }), /Loading up to 1,000 charging sessions/],
    ['paused without data', source({ isResolved: false }), /Charging-history availability has not resolved/],
    ['initial failure', source({ error: new Error('History unavailable') }), /Charging history is unavailable/],
    ['no vehicle', source({ vehicleSelected: false, isResolved: false }), /Select a vehicle to make its returned charging evidence available/],
  ])('keeps the frame without fabricated counts during %s', (_name, state, message) => {
    mount(state);
    expect(screen.getByTestId('pack-capacity-soc-window-profile')).toBeInTheDocument();
    expect(screen.getByRole('figure')).toHaveAccessibleDescription(message);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument();
  });

  it('retains known-empty resolved bins with real zero counts and unknown measurements', () => {
    mount(source());
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(emptyResult.socWindowProfile.length);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const cells = within(row).getAllByRole('cell');
      expect(cells[1]).toHaveTextContent(/^0$/);
      expect(cells[2]).toHaveTextContent('—');
      expect(cells[3]).toHaveTextContent('—');
    }
  });

  it('recovers from paused initial history, retains refresh-failure data, and clears stale prose on recovery', () => {
    const view = mount(source({ isResolved: false }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    view.update(source(), populatedResult);
    const before = screen.getByRole('table').textContent;
    expect(populatedResult.observations).toHaveLength(1);
    expect(within(screen.getByRole('table')).getByText('75')).toBeInTheDocument();

    view.update(source({ refreshError: new Error('Refresh failed') }), populatedResult);
    expect(screen.getByRole('table').textContent).toBe(before);
    expect(screen.getByRole('figure')).toHaveAccessibleDescription(/Showing the most recently loaded evidence/);

    view.update(source(), populatedResult);
    expect(screen.getByRole('table').textContent).toBe(before);
    expect(screen.queryByText(/Showing the most recently loaded evidence/)).not.toBeInTheDocument();
  });
});
