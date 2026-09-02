import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { SilentCounterPanel } from './SilentCounterPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/api/hooks/useTeslaPhysics', () => ({
  useSilentCounter: () => ({
    data: {
      drive_id: 295,
      vehicle_id: 1,
      intervals: [{
        started_at: '2026-03-03T10:20:00Z',
        ended_at: '2026-03-03T10:25:00Z',
        duration_s: 300,
        gear: 'D',
        fsd_distance_m: 1200,
        label: 'Counter silent while moving',
      }],
      unknown: false,
      honesty: 'Counter silent is not a Tesla disengagement score.',
    },
    error: null,
    isPending: false,
    isLoading: false,
    isFetching: false,
    fetchStatus: 'idle',
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
  }),
}));

describe('SilentCounterPanel', () => {
  it('labels frozen trip-meter intervals as counter silent, not disengagement', () => {
    render(
      <MemoryRouter>
        <SilentCounterPanel driveId="295" />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('Counter silent while moving').length).toBeGreaterThan(0);
    expect(screen.getByText('Counter silent is not a Tesla disengagement score.')).toBeInTheDocument();
  });
});
