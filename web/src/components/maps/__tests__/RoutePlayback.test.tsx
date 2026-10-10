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
import { formatSpeed, type SpeedUnitPref } from '@/lib/unitConversion';
import { chartTokens } from '@/lib/tokens';

const display = vi.hoisted(() => ({ speed: 'km/h' }));
const paints = vi.hoisted(() => ({
  resolve: vi.fn<(input: string, context: HTMLElement) => string | null>(),
  polyline: vi.fn(),
  endpoint: vi.fn(),
  marker: vi.fn(),
  context: null as HTMLElement | null,
  fitBounds: vi.fn(),
  setView: vi.fn(),
}));

vi.mock('@/lib/colors', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/colors')>(),
  resolveMapRendererColor: paints.resolve,
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatSpeed: (value: number | null | undefined) => {
      const speed: SpeedUnitPref = display.speed === 'mph' ? 'mph' : 'km/h';
      return formatSpeed(value, {
        distance: 'km', speed, temperature: '°C', pressure: 'bar',
        energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US',
      });
    },
  }),
}));

vi.mock('@/components/maps', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { ref: (node: HTMLElement | null) => { paints.context = node; } }, children);
  const map = {
    fitBounds: paints.fitBounds, setView: paints.setView,
    getContainer: () => paints.context!,
  };
  return {
    MapContainer: passthrough,
    Polyline: (props: unknown) => { paints.polyline(props); return null; },
    CircleMarker: (props: unknown) => { paints.endpoint(props); return null; },
    Marker: () => null,
    Popup: () => null,
    Circle: () => null,
    Rectangle: () => null,
    FeatureGroup: () => null,
    MapTileLayer: () => null,
    MapInvalidator: () => null,
    MapLayerSwitcher: () => null,
    AnimatedMarker: (props: unknown) => { paints.marker(props); return null; },
    vehicleIcon: () => ({}),
    GeofenceDrawer: () => null,
    MarkerCluster: () => null,
    RoutePlayback: () => null,
    describeFence: () => '',
    latLngBounds: () => ({ isValid: () => false }),
    useMap: () => map,
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
    display.speed = 'km/h';
    vi.clearAllMocks();
    paints.resolve.mockImplementation((input, context) => {
      if (!context.isConnected) return null;
      const roles: Record<string, string> = {
        [chartTokens.series[0]]: 'rgb(56, 94, 126)',
        [chartTokens.series[1]]: 'rgb(56, 97, 79)',
        [chartTokens.series[3]]: 'rgb(131, 70, 78)',
      };
      return roles[input] ?? (input === 'invalid' ? null : input);
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

  it('formats SI speed only at the display boundary and retains callback metrics', () => {
    const point: PlaybackPoint = { ...trail[0], speed: 10, power: 1200 };
    const onChange = vi.fn();
    const { rerender } = render(<RoutePlayback points={[point]} onPositionChange={onChange} />);
    expect(screen.getByText('36 km/h')).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(point, 0);
    expect(point.speed).toBe(10);
    expect(point.power).toBe(1200);
    display.speed = 'mph';
    rerender(<RoutePlayback points={[point]} onPositionChange={onChange} />);
    expect(screen.getByText('22 mph')).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(point, 0);
  });

  it('retains optional metrics, custom map height, outer classes and hidden controls', () => {
    const { rerender } = render(
      <RoutePlayback points={trail} height="55vh" className="route-frame" showControls={false} />,
    );
    const map = screen.getByRole('application');
    expect(map.style.height).toBe('55vh');
    expect(map.parentElement).toHaveClass('route-frame');
    expect(screen.getByText(/^80(?:\.0+)?%$/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
    rerender(<RoutePlayback points={[{ lat: 1, lng: 2, timestamp: t0 }]} height={320} />);
    expect(screen.getByRole('application')).toHaveStyle({ height: '320px' });
    expect(screen.queryByText(/km\/h|mph|%/)).not.toBeInTheDocument();
  });

  it('preserves autoplay completion, restart and pause callbacks', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<RoutePlayback points={trail} autoPlay onPositionChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(25_000));
    expect(onChange).toHaveBeenLastCalledWith(trail[2], 2);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(onChange).toHaveBeenLastCalledWith(trail[0], 0);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    onChange.mockClear();
    act(() => vi.advanceTimersByTime(25_000));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps the empty override when all coordinates are invalid', () => {
    render(<RoutePlayback points={[{ lat: NaN, lng: 2, timestamp: t0 }]} emptyMessage="GPS unavailable" />);
    expect(screen.getByText('GPS unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('application')).not.toBeInTheDocument();
  });

  it('retains keyboard seeking, speed cycling, stop and dataset cursor clamping', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { rerender } = render(<RoutePlayback points={trail} onPositionChange={onChange} />);
    const slider = screen.getByRole('slider', { name: 'Playback progress' });
    slider.focus();
    fireEvent.keyDown(slider, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(trail[2], 2);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(trail[0], 0);
    fireEvent.click(screen.getByRole('button', { name: 'Playback speed: 1x' }));
    expect(screen.getByRole('button', { name: 'Playback speed: 10x' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    act(() => vi.advanceTimersByTime(1000));
    expect(onChange).toHaveBeenLastCalledWith(trail[1], 1);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onChange).toHaveBeenLastCalledWith(trail[0], 0);
    fireEvent.keyDown(slider, { key: 'End' });
    rerender(<RoutePlayback points={[trail[0]]} onPositionChange={onChange} />);
    expect(onChange).toHaveBeenLastCalledWith(trail[0], 0);
  });

  it('resolves the exact approved series in the attached map and keeps semantic DOM position paint', () => {
    render(<RoutePlayback points={trail} />);
    expect(paints.context?.isConnected).toBe(true);
    for (const role of [chartTokens.series[0], chartTokens.series[1], chartTokens.series[3]]) {
      expect(paints.resolve).toHaveBeenCalledWith(role, paints.context);
    }
    expect(paints.polyline).toHaveBeenLastCalledWith({
      positions: trail.map((point) => [point.lat, point.lng]),
      pathOptions: { color: 'rgb(56, 94, 126)', weight: 4, opacity: 0.8 },
    });
    expect(paints.endpoint).toHaveBeenCalledWith({
      center: [trail[0].lat, trail[0].lng], radius: 7,
      pathOptions: { color: 'rgb(56, 97, 79)', fillColor: 'rgb(56, 97, 79)', fillOpacity: 1, weight: 2 },
    });
    expect(paints.endpoint).toHaveBeenCalledWith({
      center: [trail[2].lat, trail[2].lng], radius: 7,
      pathOptions: { color: 'rgb(131, 70, 78)', fillColor: 'rgb(131, 70, 78)', fillOpacity: 1, weight: 2 },
    });
    expect(paints.marker).toHaveBeenLastCalledWith(expect.objectContaining({ color: 'var(--semantic-info)' }));
    expect(screen.queryByText('Route playback map: Unavailable')).not.toBeInTheDocument();
  });

  it('retains explicit paint and falls back only to its declared trail role', () => {
    const { rerender } = render(<RoutePlayback points={trail} trailColor="rgb(12, 34, 56)" markerColor="purple" />);
    expect(paints.polyline).toHaveBeenLastCalledWith(expect.objectContaining({
      pathOptions: { color: 'rgb(12, 34, 56)', weight: 4, opacity: 0.8 },
    }));
    expect(paints.marker).toHaveBeenLastCalledWith(expect.objectContaining({ color: 'purple' }));
    rerender(<RoutePlayback points={trail} trailColor="invalid" />);
    expect(paints.resolve).toHaveBeenCalledWith('invalid', paints.context);
    expect(paints.polyline).toHaveBeenLastCalledWith(expect.objectContaining({
      pathOptions: { color: 'rgb(56, 94, 126)', weight: 4, opacity: 0.8 },
    }));
  });

  it('defers unresolved paths with feedback while preserving source, controls and callbacks', () => {
    paints.resolve.mockReturnValue(null);
    const onChange = vi.fn();
    render(<RoutePlayback points={trail} onPositionChange={onChange} />);
    expect(paints.polyline).not.toHaveBeenCalled();
    expect(paints.endpoint).not.toHaveBeenCalled();
    expect(screen.getByText('Route playback map: Unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('application')).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(trail[0], 0);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Playback progress' }), { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(trail[2], 2);
  });

  it('refreshes custom/theme paint and recovers without resetting the cursor, camera or callbacks', async () => {
    const onChange = vi.fn();
    const { unmount } = render(<RoutePlayback points={trail} onPositionChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Playback progress' }), { key: 'End' });
    onChange.mockClear();
    paints.setView.mockClear();
    paints.fitBounds.mockClear();
    paints.resolve.mockReturnValue(null);
    await act(async () => { document.documentElement.setAttribute('data-theme', 'unavailable'); });
    expect(screen.getByText('Route playback map: Unavailable')).toBeInTheDocument();
    paints.resolve.mockReturnValue('rgb(45, 67, 89)');
    await act(async () => { document.documentElement.setAttribute('data-theme', 'custom'); });
    expect(screen.queryByText('Route playback map: Unavailable')).not.toBeInTheDocument();
    expect(paints.polyline).toHaveBeenLastCalledWith(expect.objectContaining({
      pathOptions: { color: 'rgb(45, 67, 89)', weight: 4, opacity: 0.8 },
    }));
    expect(screen.getByText('3/3')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(paints.setView).not.toHaveBeenCalled();
    expect(paints.fitBounds).not.toHaveBeenCalled();
    unmount();
    paints.resolve.mockClear();
    await act(async () => { document.documentElement.removeAttribute('data-theme'); });
    expect(paints.resolve).not.toHaveBeenCalled();
  });

  it('refreshes forced-colors and color-scheme events and removes media listeners on unmount', () => {
    const listeners = new Map<string, EventListener>();
    const remove = vi.fn();
    const media = vi.fn((query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        if (typeof listener === 'function') listeners.set(query, listener);
      },
      removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        remove(type, listener);
        if (listeners.get(query) === listener) listeners.delete(query);
      },
    }));
    vi.stubGlobal('matchMedia', media);
    const onChange = vi.fn();
    const { unmount } = render(<RoutePlayback points={trail} onPositionChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Playback progress' }), { key: 'End' });
    onChange.mockClear();
    paints.setView.mockClear();
    paints.fitBounds.mockClear();
    for (const query of ['(forced-colors: active)', '(prefers-color-scheme: dark)']) {
      expect(media).toHaveBeenCalledWith(query);
      expect(listeners.get(query)).toBeTypeOf('function');
      paints.resolve.mockClear();
      paints.resolve.mockReturnValue('rgb(78, 90, 123)');
      act(() => { listeners.get(query)?.(new Event('change')); });
      expect(paints.resolve).toHaveBeenCalledWith(chartTokens.series[0], paints.context);
      expect(paints.resolve).toHaveBeenCalledWith(chartTokens.series[1], paints.context);
      expect(paints.resolve).toHaveBeenCalledWith(chartTokens.series[3], paints.context);
      expect(paints.polyline).toHaveBeenLastCalledWith(expect.objectContaining({
        pathOptions: { color: 'rgb(78, 90, 123)', weight: 4, opacity: 0.8 },
      }));
      expect(screen.getByText('3/3')).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
      expect(paints.setView).not.toHaveBeenCalled();
      expect(paints.fitBounds).not.toHaveBeenCalled();
    }
    const registered = [...listeners.values()];
    unmount();
    expect(remove).toHaveBeenCalledTimes(2);
    for (const listener of registered) expect(remove).toHaveBeenCalledWith('change', listener);
    expect(listeners.size).toBe(0);
  });
});
