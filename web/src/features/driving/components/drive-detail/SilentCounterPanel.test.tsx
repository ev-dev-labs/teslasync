import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { SilentCounterPanel } from './SilentCounterPanel';
import { formatDateTime } from '@/lib/dateFormat';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ locale: 'de-DE', settings: { tz_display_default: 'user', timezone_user: 'America/Los_Angeles', unit_of_length: 'km', decimal_precision: 2 } }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: null }),
}));

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
      }, ...['2026-04-02T00:30:00Z', 'invalid', ''].map((started_at) => ({
        started_at, ended_at: '2026-04-02T08:30:00Z', duration_s: 300, gear: 'D', fsd_distance_m: 1200, label: 'Counter silent while moving',
      }))],
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
  it('uses saved date preferences without losing source timestamps', () => {
    const { container } = render(<MemoryRouter><SilentCounterPanel driveId="295" /></MemoryRouter>);
    for (const at of ['2026-04-02T00:30:00Z', '2026-04-02T08:30:00Z', 'invalid', '']) {
      const time = Array.from(container.querySelectorAll('time')).find((node) => node.getAttribute('datetime') === at);
      expect(time).toHaveTextContent(formatDateTime(at, { locale: 'de-DE', tz: 'America/Los_Angeles' }));
      expect(time).not.toHaveAttribute('title');
    }
  });

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
