import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ParkTruth, VampireSplit } from '@/types/teslaPhysics';
import { VampireCulpritPanel } from './VampireCulpritPanel';

const park: ParkTruth = {
  confirmed_park: true,
  park_confirmed_at: '2026-04-01T04:00:00Z',
  neutral_rolling: false,
  sentry_reported: true,
  sentry_counted: true,
  cabin_overheat_reported: false,
  cabin_overheat_counted: false,
  preconditioning_reported: false,
  preconditioning_counted: false,
  rejected: [],
  honesty: 'Park confirmed.',
};

const split: VampireSplit = {
  vehicle_id: 1,
  complete_plugged: [],
  unplugged: [],
  complete_plugged_drain_pct: 0.2,
  unplugged_drain_pct: 1.1,
  honesty: 'Split uses confirmed Park.',
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
  useParkTruth: () => ({
    data: park,
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
  useVampireSplit: () => ({
    data: split,
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

describe('VampireCulpritPanel', () => {
  it('tells the owner to turn Sentry off tonight', () => {
    render(<VampireCulpritPanel vehicleId="1" />);
    expect(screen.getByTestId('vampire-culprits')).toBeInTheDocument();
    expect(screen.getByText(/Turn Sentry off at home tonight/)).toBeInTheDocument();
  });
});
