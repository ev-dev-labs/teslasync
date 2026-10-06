import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@tanstack/react-query', async () => ({
  ...await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query'),
  useQuery: mocks.query,
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => ({ data: [{ id: 1 }] }) }));

import RecentDrivesListWidget from './RecentDrivesListWidget';

const start = 'A complete departure address whose last words are important';
const end = 'A complete destination address that remains readable without hover';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockReturnValue({
    data: [
      { id: 17, distance_m: 10000, duration_s: 600, start_ts: '2026-10-05T10:00:00Z', start_address: start, end_address: end, start_soc_pct: 60, end_soc_pct: 55 },
      { id: 9, distance_m: null, duration_s: null, start_ts: '2026-10-04T10:00:00Z', start_address: null, end_address: null, start_soc_pct: null, end_soc_pct: null },
    ],
    isLoading: false, isFetching: false, isStale: false, isError: false, error: null, dataUpdatedAt: 0, refetch: vi.fn(),
  });
});

describe('recent drives complete row preservation', () => {
  it('keeps source order, full addresses, battery operands and real navigation', () => {
    render(<MemoryRouter><RecentDrivesListWidget size={{ cols: 3, rows: 2 }} /></MemoryRouter>);
    expect(screen.getByText(start)).toBeInTheDocument();
    expect(screen.getByText(end)).toBeInTheDocument();
    expect(screen.getByText('60.00% → 55.00%')).toBeInTheDocument();
    expect(screen.getByText('?% → ?%')).toBeInTheDocument();
    const rows = screen.getAllByRole('link', { name: /^Drive:/ });
    expect(rows[0]).toHaveAttribute('href', '/drives/17');
    expect(rows[1]).toHaveAttribute('href', '/drives/9');
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/drives');
  });

  it.each([
    { cols: 1, rows: 1, limit: 5 },
    { cols: 2, rows: 2, limit: 7 },
    { cols: 3, rows: 2, limit: 10 },
  ])('preserves the saved-size request limit $limit', ({ cols, rows, limit }) => {
    render(<MemoryRouter><RecentDrivesListWidget vehicleId={42} size={{ cols, rows }} /></MemoryRouter>);
    expect(mocks.query).toHaveBeenCalledWith(expect.objectContaining({
      queryKey: ['drives', 42, `recent-list-${limit}`],
      enabled: true,
    }));
  });
});
