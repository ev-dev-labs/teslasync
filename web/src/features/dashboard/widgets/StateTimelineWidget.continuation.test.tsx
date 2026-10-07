import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ summary: vi.fn(), timeline: vi.fn() }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => ({ data: [{ id: 1 }] }) }));
vi.mock('@/api/hooks/useAnalytics', () => ({ useStateSummary: mocks.summary, useTimeline: mocks.timeline }));
vi.mock('@/hooks/useTimeFormatPreference', () => ({ useTimeFormatPreference: () => 'absolute' }));

import StateTimelineWidget from './StateTimelineWidget';

function query<T>(data: T) {
  return { data, refetch: vi.fn(), error: null, isError: false, isLoading: false, isFetching: false, isStale: false, dataUpdatedAt: 0 };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.summary.mockReturnValue(query([
    { state: 'driving', totalMin: 180, count: 3 },
    { state: 'idle', totalMin: 60, count: 1 },
  ]));
  mocks.timeline.mockReturnValue(query([
    { state: 'driving', startDate: '2026-10-05T10:00:00Z', durationMin: 100 },
    { state: 'asleep', startDate: '2026-10-05T11:40:00Z', durationMin: 0.1 },
  ]));
});

describe('state timeline canonical composition preservation', () => {
  it('keeps summary order, durations and percentages as readable evidence', () => {
    render(<MemoryRouter><StateTimelineWidget size={{ cols: 2, rows: 2 }} /></MemoryRouter>);
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('driving');
    expect(rows[0]).toHaveTextContent('3h 0m');
    expect(rows[0]).toHaveTextContent('75.00%');
    expect(rows[1]).toHaveTextContent('idle');
    expect(rows[1]).toHaveTextContent('1h 0m');
    expect(rows[1]).toHaveTextContent('25.00%');
  });

  it('keeps every wide transition in source order even when a sub-0.5% decorative fill is omitted', () => {
    render(<MemoryRouter><StateTimelineWidget size={{ cols: 3, rows: 2 }} /></MemoryRouter>);
    const rails = screen.getAllByRole('img');
    expect(rails).toHaveLength(2);
    expect(rails[1].children).toHaveLength(1);
    const rows = within(screen.getAllByRole('list')[1]).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('driving');
    expect(rows[1]).toHaveTextContent('asleep');
    expect(rows[1]).toHaveTextContent('0.1');
    expect(rows[1]).toHaveTextContent('min');
    expect(screen.getByText('24h timeline')).toBeInTheDocument();
  });

  it('retains the compact five-cell policy without introducing a duplicate full legend', () => {
    mocks.summary.mockReturnValue(query(
      ['driving', 'charging', 'asleep', 'idle', 'offline', 'unlisted'].map(state => ({ state, totalMin: 10, count: 1 })),
    ));
    render(<MemoryRouter><StateTimelineWidget size={{ cols: 1, rows: 2 }} /></MemoryRouter>);
    expect(screen.getByRole('img').children).toHaveLength(6);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    ['driving', 'charging', 'asleep', 'idle', 'offline'].forEach(state => expect(screen.getByText(state)).toBeInTheDocument());
    expect(screen.queryByText('unlisted')).not.toBeInTheDocument();
  });
});
