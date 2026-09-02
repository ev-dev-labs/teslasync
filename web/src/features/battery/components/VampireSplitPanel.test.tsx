import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { VampireSplitPanel } from './VampireSplitPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/api/hooks/useTeslaPhysics', () => ({
  useVampireSplit: () => ({
    data: {
      vehicle_id: 1,
      complete_plugged: [{
        kind: 'complete_plugged',
        started_at: '2026-03-03T02:00:00Z',
        ended_at: '2026-03-03T03:00:00Z',
        duration_s: 3600,
        start_soc_pct: 80,
        end_soc_pct: 79.4,
        drain_pct: 0.6,
        park_confirmed: true,
      }],
      unplugged: [{
        kind: 'unplugged',
        started_at: '2026-03-03T03:10:00Z',
        ended_at: '2026-03-03T08:10:00Z',
        duration_s: 18000,
        start_soc_pct: 79.4,
        end_soc_pct: 78.1,
        drain_pct: 1.3,
        park_confirmed: true,
      }],
      complete_plugged_drain_pct: 0.6,
      unplugged_drain_pct: 1.3,
      honesty: 'Drain while sitting at limit is not the same as drain after unplug.',
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

describe('VampireSplitPanel', () => {
  it('separates complete-plugged drain from unplugged drain', () => {
    render(<VampireSplitPanel vehicleId="1" />);
    expect(screen.getByText('Complete-plugged vs unplugged drain')).toBeInTheDocument();
    expect(screen.getAllByText('0.60%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1.30%').length).toBeGreaterThan(0);
    expect(screen.getByText('Drain while sitting at limit is not the same as drain after unplug.')).toBeInTheDocument();
  });
});
