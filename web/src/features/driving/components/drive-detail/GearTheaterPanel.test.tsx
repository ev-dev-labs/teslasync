import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GearTheaterPanel } from './GearTheaterPanel';
import { formatDateTime } from '@/lib/dateFormat';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ locale: 'de-DE', settings: { tz_display_default: 'user', timezone_user: 'America/Los_Angeles' } }),
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
  useGearTheater: () => ({
    data: {
      drive_id: 295,
      vehicle_id: 1,
      events: [
        { at: '2026-03-03T10:00:00Z', gear: 'D', charge_port_door_open: false, charge_port_latch: 'Engaged' },
        { at: '2026-03-03T10:50:00Z', gear: 'P', charge_port_door_open: false, charge_port_latch: 'Engaged' },
        ...['2026-04-02T00:30:00Z', '2026-04-02T08:30:00Z', 'invalid', ''].map((at) => ({ at, gear: 'N' })),
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
  it('keeps gear, latch, port state and timestamps available on phones', () => {
    const observers: { element: Element; callback: ResizeObserverCallback }[] = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) { observers.push({ element, callback: this.callback }); }
      unobserve() {}
      disconnect() {}
    });
    try {
      render(<GearTheaterPanel driveId="295" />);
      act(() => observers.forEach(({ element, callback }) => callback(
        [{ target: element, contentRect: { width: 360 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      )));
      const mobile = screen.getByRole('group', { name: 'drive-gear-events' });
      expect(mobile).toHaveTextContent('Port closed');
      expect(mobile).toHaveTextContent('Engaged');
      fireEvent.click(within(mobile).getAllByRole('button', { name: 'Quick view' })[0]);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveTextContent('Gear');
      expect(dialog).toHaveTextContent('Charge-port latch');
      expect(dialog).toHaveTextContent('Port closed');
      expect(dialog).toHaveTextContent(formatDateTime('2026-03-03T10:00:00Z', {
        locale: 'de-DE', tz: 'America/Los_Angeles',
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses saved locale and timezone across day boundaries and guards missing or invalid dates', () => {
    const { container } = render(<GearTheaterPanel driveId="295" />);
    for (const at of ['2026-04-02T00:30:00Z', '2026-04-02T08:30:00Z', 'invalid', '']) {
      const time = Array.from(container.querySelectorAll('time')).find((node) => node.getAttribute('datetime') === at);
      expect(time).toHaveTextContent(formatDateTime(at, { locale: 'de-DE', tz: 'America/Los_Angeles' }));
      expect(time).not.toHaveAttribute('title');
    }
  });

  it('replays P/R/N/D without calling Neutral parked', () => {
    render(<GearTheaterPanel driveId="295" />);
    expect(screen.getByText('Gear theater')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
    expect(screen.getByText('P')).toBeInTheDocument();
    expect(screen.getByText('Gear theater is Tesla shift language, not a GPS trip.')).toBeInTheDocument();
  });
});
