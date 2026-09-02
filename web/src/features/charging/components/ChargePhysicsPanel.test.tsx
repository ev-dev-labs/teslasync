import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { ChargePhysics } from '@/types/teslaPhysics';
import { ChargePhysicsPanel } from './ChargePhysicsPanel';

const physics: ChargePhysics = {
  session_id: 12,
  vehicle_id: 1,
  started_at: '2026-03-03T01:00:00Z',
  ended_at: '2026-03-03T02:10:00Z',
  story: [
    { state: 'Charging', started_at: '2026-03-03T01:00:00Z', ended_at: '2026-03-03T02:00:00Z', duration_s: 3600, at_limit: false },
    { state: 'Complete', started_at: '2026-03-03T02:00:00Z', ended_at: '2026-03-03T02:10:00Z', duration_s: 600, at_limit: true },
    { state: 'Disconnected', started_at: '2026-03-03T02:10:00Z', ended_at: '2026-03-03T02:10:00Z', duration_s: 0, at_limit: true },
  ],
  at_limit_still_plugged_s: 600,
  etiquette: {
    applicable: true,
    charger_type: 'DC',
    complete_at: '2026-03-03T02:00:00Z',
    unplug_at: '2026-03-03T02:10:00Z',
    dwell_s: 600,
    honesty: 'DC Complete-to-unplug dwell is etiquette time, not a charge fault.',
  },
  schedule: {
    scheduled_mode: null,
    scheduled_start_at: null,
    stopped_at: null,
    charging_resumed_at: null,
    waited_for_schedule: null,
    charged_anyway: null,
    unknown: true,
    honesty: 'Scheduled-charge truth is unknown without a Stopped-then-Charging pair.',
  },
  honesty: 'Charge story uses DetailedChargeState. Stopped is still plugged; Disconnected is unplug.',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      ),
  }),
}));

vi.mock('@/api/hooks/useTeslaPhysics', () => ({
  useChargePhysics: () => ({
    data: physics,
    error: null,
    isPending: false,
    isLoading: false,
    isFetching: false,
    isError: false,
    isSuccess: true,
    fetchStatus: 'idle',
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
  }),
}));

describe('ChargePhysicsPanel', () => {
  it('tells the charge story including at-limit dwell and unplug', () => {
    render(
      <MemoryRouter>
        <ChargePhysicsPanel sessionId="12" />
      </MemoryRouter>,
    );

    expect(screen.getByText('Charge physics')).toBeInTheDocument();
    expect(screen.getByText(/Disconnected\s*·\s*at limit/)).toBeInTheDocument();
    expect(screen.getByText('At limit, still plugged 10 min.')).toBeInTheDocument();
    expect(screen.getByText('Supercharger dwell after Complete: 10 min.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Tesla physics cockpit' })).toHaveAttribute('href', '/physics-cockpit');
  });
});
