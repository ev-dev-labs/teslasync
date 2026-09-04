import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GearTheaterPanel } from './GearTheaterPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/api/hooks/useTeslaPhysics', () => ({
  useGearTheater: () => ({
    data: {
      drive_id: 295,
      vehicle_id: 1,
      events: [
        { at: '2026-03-03T10:00:00Z', gear: 'D', charge_port_door_open: false, charge_port_latch: 'Engaged' },
        { at: '2026-03-03T10:50:00Z', gear: 'P', charge_port_door_open: false, charge_port_latch: 'Engaged' },
      ],
      honesty: 'Gear theater is Tesla shift language, not a GPS trip.',
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

describe('GearTheaterPanel', () => {
  it('replays P/R/N/D without calling Neutral parked', () => {
    render(<GearTheaterPanel driveId="295" />);
    expect(screen.getByText('Gear theater')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
    expect(screen.getByText('P')).toBeInTheDocument();
    expect(screen.getByText('Gear theater is Tesla shift language, not a GPS trip.')).toBeInTheDocument();
  });
});
