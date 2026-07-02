/** Unit tests for `<GeofenceDrawer>`. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

type MapPointerPayload = { lngLat: { lat: number; lng: number } };
type Listener = (payload: MapPointerPayload) => void;

const shared = vi.hoisted(() => {
  class FakeMap {
    listeners = new Map<string, Listener[]>();
    canvas = { style: { cursor: '' } };

    on(event: string, fn: Listener) {
      const arr = this.listeners.get(event) ?? [];
      this.listeners.set(event, [...arr, fn]);
      return this;
    }

    off(event: string, fn: Listener) {
      const arr = this.listeners.get(event) ?? [];
      this.listeners.set(
        event,
        arr.filter((listener) => listener !== fn),
      );
      return this;
    }

    emit(event: string, payload: MapPointerPayload) {
      for (const fn of this.listeners.get(event) ?? []) fn(payload);
    }

    reset() {
      this.listeners.clear();
      this.canvas.style.cursor = '';
    }

    getCanvas() {
      return this.canvas;
    }
  }

  return { map: new FakeMap() };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('../MapTileLayer', () => {
  interface CircleProps {
    center: [number, number] | { lat: number; lng: number };
    radius: number;
    color?: string;
  }

  const toLatLng = (center: CircleProps['center']) =>
    Array.isArray(center) ? { lat: center[0], lng: center[1] } : center;

  return {
    Circle: ({ center, radius, color }: CircleProps) => {
      const point = toLatLng(center);
      return (
        <div
          data-testid="circle"
          data-lat={point.lat}
          data-lng={point.lng}
          data-radius={radius}
          data-color={color}
        />
      );
    },
    useMap: () => ({
      getMaplibreMap: () => ({
        getMap: () => shared.map,
      }),
    }),
  };
});

import { GeofenceDrawer, describeFence } from '../GeofenceDrawer';

const clickMap = (lat: number, lng: number) => {
  shared.map.emit('click', { lngLat: { lat, lng } });
};

const moveMap = (lat: number, lng: number) => {
  shared.map.emit('mousemove', { lngLat: { lat, lng } });
};

/* ── tests ─────────────────────────────────────────────────────────── */

describe('GeofenceDrawer', () => {
  beforeEach(() => {
    shared.map.reset();
  });

  it('renders valid persisted circles and skips invalid fences', () => {
    render(
      <GeofenceDrawer
        fences={[
          { id: 'home', lat: 1, lng: 2, radius: 100 },
          { id: 'missing-radius', lat: 3, lng: 4 },
        ]}
        onCreate={() => {}}
      />,
    );

    const circles = screen.getAllByTestId('circle');
    expect(circles).toHaveLength(1);
    expect(circles[0]).toHaveAttribute('data-lat', '1');
    expect(circles[0]).toHaveAttribute('data-lng', '2');
    expect(circles[0]).toHaveAttribute('data-radius', '100');
  });

  it('emits onCreate with circle geometry after center and radius clicks', async () => {
    const onCreate = vi.fn();
    render(<GeofenceDrawer fences={[]} onCreate={onCreate} />);

    fireEvent.click(screen.getByRole('button', { name: 'Draw geofence' }));
    expect(shared.map.canvas.style.cursor).toBe('crosshair');

    await act(async () => clickMap(37.7749, -122.4194));
    await act(async () => moveMap(37.7759, -122.4194));
    await waitFor(() =>
      expect(screen.getByTestId('circle')).toHaveAttribute('data-lat', '37.7749'),
    );

    await act(async () => clickMap(37.7759, -122.4194));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
      shape: 'circle',
      lat: 37.7749,
      lng: -122.4194,
    });
    expect(onCreate.mock.calls[0]?.[0].radius).toBeGreaterThan(100);
    expect(screen.getByRole('button', { name: 'Draw geofence' })).toBeInTheDocument();
  });

  it('cancels drawing with Escape', () => {
    const onCreate = vi.fn();
    render(<GeofenceDrawer fences={[]} onCreate={onCreate} />);

    fireEvent.click(screen.getByRole('button', { name: 'Draw geofence' }));
    act(() => clickMap(1, 2));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Draw geofence' })).toBeInTheDocument();
  });

  it('describeFence builds an a11y-friendly label for circles and polygons', () => {
    expect(
      describeFence({ id: 1, name: 'Home', lat: 37.7749, lng: -122.4194, radius: 100 }),
    ).toBe('Home — 100m circle around 37.7749, -122.4194');
    expect(
      describeFence({
        id: 2,
        name: 'Yard',
        polygon: [
          [0, 0],
          [0, 1],
          [1, 1],
        ],
      }),
    ).toBe('Yard — 3-vertex polygon');
    expect(describeFence({ id: 3 })).toBe('Geofence');
  });
});
