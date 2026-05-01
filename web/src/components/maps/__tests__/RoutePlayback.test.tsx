/**
 * Unit tests for `<RoutePlayback>`.
 *
 * The component pulls in leaflet via the maps barrel; we mock the barrel so
 * MapContainer / Polyline / etc. become inert stubs and the rest of the
 * component logic (state, controls, callbacks) can be tested under jsdom.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';

vi.mock('@/components/maps', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children);
  return {
    MapContainer: passthrough,
    Polyline: () => null,
    CircleMarker: () => null,
    Marker: () => null,
    Popup: () => null,
    Circle: () => null,
    Rectangle: () => null,
    FeatureGroup: () => null,
    MapTileLayer: () => null,
    MapInvalidator: () => null,
    MapLayerSwitcher: () => null,
    AnimatedMarker: () => null,
    vehicleIcon: () => ({}),
    GeofenceDrawer: () => null,
    MarkerCluster: () => null,
    RoutePlayback: () => null,
    describeFence: () => '',
    latLngBounds: () => ({ isValid: () => false }),
    useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn() }),
  };
});

vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: false, durationMs: 200 }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

import { RoutePlayback, type PlaybackPoint } from '../RoutePlayback';

const t0 = '2024-01-01T00:00:00Z';
const t1 = '2024-01-01T00:00:10Z';
const t2 = '2024-01-01T00:00:20Z';

const trail: PlaybackPoint[] = [
  { lat: 37.7749, lng: -122.4194, timestamp: t0, speed: 0, soc: 80 },
  { lat: 37.7758, lng: -122.4174, timestamp: t1, speed: 25, soc: 79 },
  { lat: 37.7768, lng: -122.4154, timestamp: t2, speed: 30, soc: 78 },
];

describe('RoutePlayback', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the empty state when no points are supplied', () => {
    render(<RoutePlayback points={[]} emptyMessage="Nothing to replay" />);
    expect(screen.getByText('Nothing to replay')).toBeInTheDocument();
  });

  it('fires onPositionChange with index 0 on initial mount when points are present', () => {
    const onChange = vi.fn();
    render(<RoutePlayback points={trail} onPositionChange={onChange} />);
    expect(onChange).toHaveBeenCalled();
    const [point, idx] = onChange.mock.calls[0];
    expect(idx).toBe(0);
    expect(point.timestamp).toBe(t0);
  });

  it('renders an accessible application landmark with the supplied aria-label', () => {
    render(<RoutePlayback points={trail} ariaLabel="Drive replay" />);
    const region = screen.getByRole('application', { name: /drive replay/i });
    expect(region).toBeInTheDocument();
  });

  it('advances the cursor when the user clicks Play (uses fake timers)', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <RoutePlayback
        points={trail}
        onPositionChange={onChange}
        showLayerSwitcher={false}
      />,
    );
    onChange.mockClear();
    const playBtn = screen.getByRole('button', { name: 'Play' });
    fireEvent.click(playBtn);
    // Total trail span is 20s. Default speed is 1x (50 ms tick * 1 = 50 ms playback).
    // Step real time forward 25s — past the end — to collapse the run.
    act(() => {
      vi.advanceTimersByTime(25_000);
    });
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(lastCall[1]).toBeGreaterThan(0);
  });
});
