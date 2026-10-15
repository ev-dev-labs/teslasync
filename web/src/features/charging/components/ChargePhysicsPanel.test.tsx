import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DataStateSource } from '@/api/dataState';
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

let query: DataStateSource<ChargePhysics>;
const refetch = vi.fn();

vi.mock('@/api/hooks/useTeslaPhysics', () => ({
  useChargePhysics: () => query,
}));

function panel() {
  return <MemoryRouter><ChargePhysicsPanel sessionId="12" /></MemoryRouter>;
}

describe('ChargePhysicsPanel', () => {
  beforeEach(() => {
    refetch.mockReset();
    query = {
      data: physics,
      error: null,
      isPending: false,
      isLoading: false,
      isFetching: false,
      isError: false,
      isSuccess: true,
      fetchStatus: 'idle',
      dataUpdatedAt: Date.now(),
      refetch,
    };
  });

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

  it('shows a skeleton only during active initial loading', () => {
    query = { data: undefined, isPending: true, isFetching: true, fetchStatus: 'fetching', refetch };
    render(panel());
    expect(screen.getByText('Charge physics')).toBeInTheDocument();
    expect(screen.getByTestId('charge-physics-loading')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(physics.honesty)).not.toBeInTheDocument();
  });

  it('shows a paused source and retries without pretending to load or report empty data', () => {
    query = { data: undefined, isPending: true, fetchStatus: 'paused', refetch };
    render(panel());
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    expect(screen.queryByTestId('charge-physics-loading')).not.toBeInTheDocument();
    expect(screen.queryByText('No data available')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('preserves honesty and confirmed zero durations for a successful empty story', () => {
    query.data = {
      ...physics,
      story: [],
      at_limit_still_plugged_s: 0,
      etiquette: { ...physics.etiquette, dwell_s: 0 },
    };
    render(panel());
    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.getByText('At limit, still plugged 0 min.')).toBeInTheDocument();
    expect(screen.getByText('Supercharger dwell after Complete: 0 min.')).toBeInTheDocument();
    expect(screen.getByText(physics.honesty)).toBeInTheDocument();
    expect(screen.getByText(physics.etiquette.honesty)).toBeInTheDocument();
    expect(screen.getByText(physics.schedule.honesty)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each(['failed', 'paused'] as const)('retains specialists during %s refresh and removes the notice after recovery', (phase) => {
    const view = render(panel());
    query = {
      ...query,
      error: phase === 'failed' ? new Error('Physics refresh failed') : null,
      isError: phase === 'failed',
      isSuccess: false,
      fetchStatus: phase === 'paused' ? 'paused' : 'idle',
    };
    view.rerender(panel());
    expect(screen.getByText(phase === 'failed' ? 'Cached · refresh failed' : 'Refresh paused')).toBeInTheDocument();
    expect(screen.getByText(physics.honesty)).toBeInTheDocument();
    expect(screen.getByText(physics.schedule.honesty)).toBeInTheDocument();
    expect(screen.getByText('At limit, still plugged 10 min.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Tesla physics cockpit' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources' }));
    expect(refetch).toHaveBeenCalledTimes(1);

    query = { ...query, error: null, isError: false, isSuccess: true, isFetching: true, fetchStatus: 'fetching' };
    view.rerender(panel());
    expect(screen.getByText(physics.honesty)).toBeInTheDocument();
    expect(screen.queryByTestId('charge-physics-loading')).not.toBeInTheDocument();

    query = { ...query, isFetching: false, fetchStatus: 'idle', dataUpdatedAt: Date.now() };
    view.rerender(panel());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('Cached · refresh failed')).not.toBeInTheDocument();
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
    expect(screen.getByText('Supercharger dwell after Complete: 10 min.')).toBeInTheDocument();
  });

  it('uses the fatal error retry only when there is no retained physics', () => {
    query = { data: undefined, error: new Error('Physics unavailable'), isError: true, fetchStatus: 'idle', refetch };
    render(panel());
    expect(screen.getByText('Charge physics')).toBeInTheDocument();
    expect(screen.queryByTestId('charge-physics-loading')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
