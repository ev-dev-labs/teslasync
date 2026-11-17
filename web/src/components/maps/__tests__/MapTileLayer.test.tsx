/**
 * Unit tests for the leaflet tile / control adapters in `MapTileLayer.tsx`.
 *
 * The module pulls in `react-leaflet` (jsdom-hostile), the map-config
 * `useQuery`, and the shared `<FullscreenButton>`. Following the same
 * mocking convention as the neighbouring `RoutePlayback` / `GeofenceDrawer`
 * suites, we stub the leaflet hooks + components, the settings endpoint, and
 * the fullscreen button so the three exported units — `<MapTileLayer>`,
 * `<MapInvalidator>`, and `<MapFullscreenControl>` — can be exercised under
 * jsdom for their real behaviour:
 *
 *   - provider-driven tile selection (free / azure / google) across every
 *     `MapStyle`, including the missing-key + unknown-style fallbacks,
 *   - timer-based `invalidateSize()` with unmount cancellation,
 *   - the portalled fullscreen control (corner placement, prop forwarding,
 *     no-container guard, and the `fullscreenchange` re-invalidate + cleanup).
 *
 * The map-config network boundary is mocked (never a real request); the query
 * itself runs through a genuine `QueryClient` so the `useQuery` wiring is
 * exercised end-to-end.
 */
import React from 'react';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MapConfig } from '@/api/types';
import { getAppDesignAttributes, APPLICATION_DESIGNS } from '@/components/ui/app-designs/designs';

type FakeMap = {
  getContainer: () => HTMLElement | null;
  invalidateSize: (...args: unknown[]) => void;
  on?: (event: string, handler: () => void) => void;
  off?: (event: string, handler: () => void) => void;
};

type CapturedFsProps = {
  ariaLabelEnter?: string;
  ariaLabelExit?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  targetRef: React.RefObject<HTMLElement | null>;
};

const H = vi.hoisted(() => ({
  map: null as FakeMap | null,
  getMapConfig: vi.fn(),
  fsProps: vi.fn(),
}));

// react-leaflet is jsdom-hostile — replace `TileLayer` with an observable
// node that surfaces the resolved url/attribution as data-* attributes, and
// `useMap` with the per-test fake map.
vi.mock('react-leaflet', () => ({
  TileLayer: ({ url, attribution, className }: { url: string; attribution: string; className?: string }) =>
    React.createElement('div', {
      'data-testid': 'tile-layer',
      'data-url': url,
      'data-attribution': attribution,
      className,
    }),
  useMap: () => H.map,
}));

// Network boundary: the component's `useQuery` calls `getMapConfig`. Stub it
// so no real request is made and each test can drive the provider branch.
vi.mock('@/api/settings', () => ({
  getMapConfig: () => H.getMapConfig(),
}));

// Isolate `MapFullscreenControl` from the real fullscreen primitive: the stub
// records the props it receives (so we can assert forwarding) and renders a
// real <button> exposing the enter-label for role/name queries.
vi.mock('@/components/ui/FullscreenButton', () => ({
  FullscreenButton: (props: CapturedFsProps) => {
    H.fsProps(props);
    return React.createElement('button', {
      type: 'button',
      'data-testid': 'fs-button',
      'aria-label': props.ariaLabelEnter ?? 'Enter fullscreen',
      className: props.className,
    });
  },
}));

import {
  MapTileLayer,
  MapInvalidator,
  MapFullscreenControl,
  type MapStyle,
  type MapFullscreenControlProps,
} from '../MapTileLayer';

const appendedContainers: HTMLElement[] = [];

function renderTile(style?: MapStyle, parts?: string) {
  // Row-19 contract: the layer marks the map container (map-style-dark)
  // instead of styling tiles, so every render needs a fake map.
  const { container: mapContainer, map } = makeMapWithContainer();
  if (parts) mapContainer.setAttribute('data-app-part', parts);
  H.map = map;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <MapTileLayer style={style} />
    </QueryClientProvider>,
  );
  return { ...view, mapContainer };
}

function tile(): HTMLElement {
  return screen.getByTestId('tile-layer');
}

/** Flush react-query's success re-render so it settles inside act(). */
async function settle() {
  await waitFor(() => expect(H.getMapConfig).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
}

function makeMapWithContainer(): { container: HTMLElement; map: FakeMap; invalidateSize: ReturnType<typeof vi.fn> } {
  const container = document.createElement('div');
  container.className = 'leaflet-container';
  document.body.appendChild(container);
  appendedContainers.push(container);
  const invalidateSize = vi.fn();
  return {
    container, invalidateSize,
    map: { getContainer: () => container, invalidateSize, on: vi.fn(), off: vi.fn() },
  };
}

beforeEach(() => {
  H.map = null;
  H.getMapConfig.mockReset();
  H.fsProps.mockReset();
  // Default provider: free (no key) → OSM/Esri/OpenTopo tiles.
  H.getMapConfig.mockResolvedValue({ provider: 'free', api_key: '' } satisfies MapConfig);
});

afterEach(() => {
  cleanup();
  while (appendedContainers.length) {
    appendedContainers.pop()?.remove();
  }
});

describe('MapTileLayer — free provider tile selection', () => {
  it('annotates native popup frames on opening without replacing popup content or existing part tokens', () => {
    const { container, map } = makeMapWithContainer();
    H.map = map;
    const on = vi.mocked(map.on!);
    const off = vi.mocked(map.off!);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const { unmount } = render(<QueryClientProvider client={qc}><MapTileLayer /></QueryClientProvider>);
    const popup = document.createElement('div');
    popup.className = 'leaflet-popup-content-wrapper';
    popup.setAttribute('data-app-part', 'caller-popup');
    const content = document.createElement('p');
    content.textContent = 'Original popup content';
    popup.appendChild(content);
    container.appendChild(popup);
    const markPopups = on.mock.calls.find(([event]) => event === 'popupopen')?.[1];
    expect(markPopups).toBeTypeOf('function');
    act(() => { markPopups?.(); });
    expect(popup).toHaveAttribute('data-app-part', 'caller-popup map-popup');
    expect(popup.firstElementChild).toBe(content);
    act(() => { markPopups?.(); });
    expect(popup).toHaveAttribute('data-app-part', 'caller-popup map-popup');
    unmount();
    expect(off).toHaveBeenCalledWith('popupopen', markPopups);
  });

  it('marks the real map without replacing existing parts and removes only its own token', () => {
    const { mapContainer, unmount } = renderTile('streets', 'panel');
    expect(mapContainer).toHaveAttribute('data-app-part', 'panel map');
    mapContainer.setAttribute('data-app-part', 'panel map caller-part');
    unmount();
    expect(mapContainer).toHaveAttribute('data-app-part', 'panel caller-part');
  });

  it('leaves a caller-owned map token in place after unmount', () => {
    const { mapContainer, unmount } = renderTile('streets', 'map caller-part');
    unmount();
    expect(mapContainer).toHaveAttribute('data-app-part', 'map caller-part');
  });

  it('keeps the selected tile instance, credits and query count across all application designs', async () => {
    const { mapContainer, unmount } = renderTile('satellite');
    await settle();
    const originalTile = tile();
    const url = originalTile.getAttribute('data-url');
    const attribution = originalTile.getAttribute('data-attribution');
    const calls = H.getMapConfig.mock.calls.length;
    const preview = document.createElement('div');
    preview.setAttribute('data-app-design-preview', '');
    document.body.appendChild(preview);
    preview.appendChild(mapContainer);
    try {
      for (const pack of Object.keys(APPLICATION_DESIGNS) as Array<keyof typeof APPLICATION_DESIGNS>) {
        await act(async () => {
          for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) {
            preview.setAttribute(name, value);
          }
        });
        expect(tile()).toBe(originalTile);
        expect(tile()).toHaveAttribute('data-url', url);
        expect(tile()).toHaveAttribute('data-attribution', attribution);
        expect(mapContainer).not.toHaveClass('map-style-dark');
        expect(H.getMapConfig).toHaveBeenCalledTimes(calls);
      }
    } finally {
      unmount();
      preview.remove();
    }
    expect(mapContainer).not.toHaveAttribute('data-app-part');
  });

  it('defaults to the key-free OSM basemap when no style is supplied', async () => {
    const { mapContainer } = renderTile();
    await settle();
    const el = tile();
    expect(el.getAttribute('data-url')).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(el.getAttribute('data-attribution')).toContain('OpenStreetMap');
    // Dark free tiles darken via the container marker (index.css tile-pane
    // rule); L.TileLayer ignores className so tiles never carry the filter.
    expect(mapContainer).toHaveClass('map-style-dark');
    expect(el).not.toHaveClass('[filter:invert(1)_hue-rotate(180deg)_brightness(0.85)]');
  });

  it('selects the Esri World Imagery layer for the satellite style', async () => {
    const { mapContainer } = renderTile('satellite');
    await settle();
    const el = tile();
    expect(el.getAttribute('data-url')).toContain('server.arcgisonline.com');
    expect(el.getAttribute('data-url')).toContain('World_Imagery');
    expect(el.getAttribute('data-attribution')).toContain('Esri');
    expect(mapContainer).not.toHaveClass('map-style-dark');
  });

  it('selects OpenStreetMap tiles for the streets style', async () => {
    const { mapContainer } = renderTile('streets');
    await settle();
    expect(tile().getAttribute('data-url')).toContain('tile.openstreetmap.org');
    expect(tile()).not.toHaveClass('[filter:invert(1)_hue-rotate(180deg)_brightness(0.85)]');
    expect(tile().getAttribute('data-attribution')).toContain('OpenStreetMap');
    expect(mapContainer).not.toHaveClass('map-style-dark');
  });

  it('selects OpenTopoMap tiles for the terrain style', async () => {
    const { mapContainer } = renderTile('terrain');
    await settle();
    expect(tile().getAttribute('data-url')).toContain('tile.opentopomap.org');
    expect(tile().getAttribute('data-attribution')).toContain('OpenTopoMap');
    expect(mapContainer).not.toHaveClass('map-style-dark');
  });

  it('falls back to the dark tile definition for an unknown style value', async () => {
    // `tiles['aurora']` is undefined → the `|| tiles.dark` guard applies.
    const { mapContainer } = renderTile('aurora' as MapStyle);
    await settle();
    expect(tile().getAttribute('data-url')).toContain('tile.openstreetmap.org');
    expect(mapContainer).toHaveClass('map-style-dark');
  });
});

describe('MapTileLayer — provider overrides', () => {
  it('uses Azure Maps tiles when the provider is azure and a key is present', async () => {
    H.getMapConfig.mockResolvedValue({ provider: 'azure', api_key: 'AZ-KEY-123' } satisfies MapConfig);
    const { mapContainer } = renderTile('dark');
    await waitFor(() => expect(tile().getAttribute('data-url')).toContain('atlas.microsoft.com'));
    const el = tile();
    expect(el.getAttribute('data-url')).toContain('subscription-key=AZ-KEY-123');
    expect(el.getAttribute('data-url')).toContain('tilesetId=microsoft.base.darkgrey');
    expect(el.getAttribute('data-attribution')).toContain('Azure Maps');
    // Native dark tiles need no CSS marker.
    expect(mapContainer).not.toHaveClass('map-style-dark');
  });

  it('uses Google Maps satellite tiles when the provider is google and a key is present', async () => {
    H.getMapConfig.mockResolvedValue({ provider: 'google', api_key: 'G-KEY-9' } satisfies MapConfig);
    const { mapContainer } = renderTile('satellite');
    await waitFor(() => expect(tile().getAttribute('data-url')).toContain('mt1.google.com'));
    const el = tile();
    expect(el.getAttribute('data-url')).toContain('lyrs=s'); // satellite layer id
    expect(el.getAttribute('data-url')).toContain('key=G-KEY-9');
    expect(el.getAttribute('data-attribution')).toContain('Google Maps');
    expect(mapContainer).not.toHaveClass('map-style-dark');
  });

  it('falls back to free tiles when the provider is azure but the key is missing', async () => {
    H.getMapConfig.mockResolvedValue({ provider: 'azure', api_key: '' } satisfies MapConfig);
    const { mapContainer } = renderTile('dark');
    await settle();
    // The `&& mapConfig.api_key` guard is falsy → we stay on the free basemap.
    expect(tile().getAttribute('data-url')).toContain('tile.openstreetmap.org');
    expect(tile().getAttribute('data-url')).not.toContain('atlas.microsoft.com');
    expect(mapContainer).toHaveClass('map-style-dark');
  });
});

describe('MapInvalidator', () => {
  it('remeasures native popups after layout changes and releases closed popup observations', () => {
    vi.useFakeTimers();
    const observers: { callback: ResizeObserverCallback; observer: Observer }[] = [];
    class Observer implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        observers.push({ callback, observer: this });
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal('ResizeObserver', Observer);
    try {
      const mapContainer = document.createElement('div');
      let mapWidth = 250;
      Object.defineProperty(mapContainer, 'clientWidth', { get: () => mapWidth });
      const element = document.createElement('div');
      const content = document.createElement('div');
      content.className = 'leaflet-popup-content';
      element.appendChild(content);
      Object.defineProperty(element, 'offsetWidth', { value: 365 });
      Object.defineProperty(content, 'offsetWidth', { value: 301 });
      const popup = { getElement: () => element, update: vi.fn(), options: { maxWidth: 300, minWidth: 50 } };
      const on = vi.fn<(event: string, handler: (event: { popup: typeof popup }) => void) => void>();
      const off = vi.fn();
      H.map = { getContainer: () => mapContainer, invalidateSize: vi.fn(), on, off };
      const { unmount } = render(<MapInvalidator />);
      const open = on.mock.calls.find(([event]) => event === 'popupopen')?.[1];
      const close = on.mock.calls.find(([event]) => event === 'popupclose')?.[1];
      expect(open).toBeTypeOf('function');
      act(() => open?.({ popup }));
      const resize = observers[1];
      expect(resize.observer.observe).toHaveBeenCalledWith(element);
      const entry: ResizeObserverEntry = {
        target: element, contentRect: element.getBoundingClientRect(),
        borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [],
      };
      act(() => resize.callback([entry], resize.observer));
      act(() => resize.callback([entry], resize.observer));
      expect(popup.update).not.toHaveBeenCalled();
      act(() => vi.advanceTimersToNextFrame());
      expect(popup.update).toHaveBeenCalledTimes(1);
      expect(popup.options.maxWidth).toBe(175);
      mapWidth = 500;
      act(() => observers[0].callback([], observers[0].observer));
      expect(popup.options.maxWidth).toBe(300);
      mapWidth = 250;
      act(() => observers[0].callback([], observers[0].observer));
      expect(popup.options.maxWidth).toBe(175);
      act(() => close?.({ popup }));
      expect(popup.options.maxWidth).toBe(300);
      expect(resize.observer.unobserve).toHaveBeenCalledWith(element);
      act(() => resize.callback([entry], resize.observer));
      act(() => vi.advanceTimersToNextFrame());
      expect(popup.update).toHaveBeenCalledTimes(3);
      act(() => open?.({ popup }));
      act(() => resize.callback([entry], resize.observer));
      act(() => close?.({ popup }));
      act(() => vi.advanceTimersToNextFrame());
      expect(popup.update).toHaveBeenCalledTimes(3);
      act(() => open?.({ popup }));
      act(() => resize.callback([entry], resize.observer));
      unmount();
      act(() => vi.advanceTimersToNextFrame());
      expect(popup.update).toHaveBeenCalledTimes(3);
      expect(popup.options.maxWidth).toBe(300);
      expect(resize.observer.disconnect).toHaveBeenCalledTimes(1);
      expect(off).toHaveBeenCalledWith('popupopen', open);
      expect(off).toHaveBeenCalledWith('popupclose', close);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('observes container resizes and preserves the current map center without animation', () => {
    vi.useFakeTimers();
    const observe = vi.fn();
    const disconnect = vi.fn();
    let resize = () => {};
    class Observer implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = () => callback([], this);
      }
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
    }
    vi.stubGlobal('ResizeObserver', Observer);
    try {
      const mapContainer = document.createElement('div');
      const invalidateSize = vi.fn();
      H.map = { getContainer: () => mapContainer, invalidateSize, on: vi.fn(), off: vi.fn() };
      const { unmount } = render(<MapInvalidator />);

      expect(observe).toHaveBeenCalledWith(mapContainer);
      act(() => resize());
      act(() => resize());
      expect(invalidateSize).toHaveBeenCalledTimes(2);
      expect(invalidateSize).toHaveBeenLastCalledWith({ animate: false });

      unmount();
      expect(disconnect).toHaveBeenCalledTimes(1);
      act(() => vi.advanceTimersByTime(100));
      expect(invalidateSize).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('invalidates the map size 100ms after mount and renders nothing', () => {
    vi.useFakeTimers();
    try {
      const invalidateSize = vi.fn();
      H.map = { getContainer: () => null, invalidateSize };
      const { container } = render(<MapInvalidator />);
      expect(container.firstChild).toBeNull(); // component renders null
      expect(invalidateSize).not.toHaveBeenCalled(); // not before the timer elapses
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(invalidateSize).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the pending invalidation when unmounted before the timer fires', () => {
    vi.useFakeTimers();
    try {
      const invalidateSize = vi.fn();
      H.map = { getContainer: () => null, invalidateSize };
      const { unmount } = render(<MapInvalidator />);
      unmount();
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(invalidateSize).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MapFullscreenControl', () => {
  it('portals a control into the leaflet container at the default top-right corner', () => {
    const { container, map } = makeMapWithContainer();
    H.map = map;
    render(<MapFullscreenControl />);
    const control = container.querySelector('.leaflet-control');
    expect(control).not.toBeNull();
    expect(control).toHaveAttribute('data-app-part', 'map-toolbar');
    expect(control).toHaveAttribute('data-map-control', 'fullscreen');
    expect(control?.className).toContain('top-2 right-2');
    expect(container.querySelector('[data-testid="fs-button"]')).not.toBeNull();
  });

  it('honours a custom corner position', () => {
    const { container, map } = makeMapWithContainer();
    H.map = map;
    render(<MapFullscreenControl position="bottomleft" />);
    expect(container.querySelector('.leaflet-control')?.className).toContain('bottom-2 left-2');
  });

  it('falls back to the top-right corner class for an out-of-contract position', () => {
    const { container, map } = makeMapWithContainer();
    H.map = map;
    render(
      <MapFullscreenControl position={'weird' as MapFullscreenControlProps['position']} />,
    );
    const cls = container.querySelector('.leaflet-control')?.className ?? '';
    expect(cls).toContain('top-2 right-2');
    expect(cls).not.toContain('undefined');
  });

  it('forwards aria labels, className and the live container ref to FullscreenButton', () => {
    const { container, map } = makeMapWithContainer();
    H.map = map;
    render(<MapFullscreenControl ariaLabelEnter="Grow map" ariaLabelExit="Shrink map" />);

    expect(H.fsProps).toHaveBeenCalled();
    const props = H.fsProps.mock.calls[H.fsProps.mock.calls.length - 1]?.[0] as CapturedFsProps;
    expect(props.ariaLabelEnter).toBe('Grow map');
    expect(props.ariaLabelExit).toBe('Shrink map');
    expect(props.className).toContain('bg-surface-2');
    expect(props.className).toContain('border-[var(--control-border)]');
    expect(props.className).toContain('text-[var(--text-secondary)]');
    expect(props.className).toContain('shadow-e1');
    expect(props.className).toContain('h-11 w-11 p-0 md:h-9 md:w-9');
    expect(props.size).toBe('md');
    expect(props.targetRef.current).toBe(container);
    // The button surfaces the enter-label so screen readers get a name.
    expect(screen.getByRole('button', { name: 'Grow map' })).toBeInTheDocument();
  });

  it.each(['topleft', 'topright', 'bottomleft', 'bottomright'] as const)(
    'preserves the %s corner and explicit empty label overrides',
    position => {
      const { container, map } = makeMapWithContainer();
      H.map = map;
      render(<MapFullscreenControl position={position} ariaLabelEnter="" ariaLabelExit="" />);
      const control = container.querySelector('.leaflet-control');
      expect(control).toHaveClass(
        position.startsWith('top') ? 'top-2' : 'bottom-2',
        position.endsWith('left') ? 'left-2' : 'right-2',
        'pointer-events-auto',
        'z-map-tile-control',
      );
      expect(H.fsProps).toHaveBeenLastCalledWith(expect.objectContaining({
        ariaLabelEnter: '',
        ariaLabelExit: '',
        targetRef: expect.objectContaining({ current: container }),
      }));
    },
  );

  it('renders nothing when the map has no container yet', () => {
    const invalidateSize = vi.fn();
    H.map = { getContainer: () => null, invalidateSize };
    const { container } = render(<MapFullscreenControl />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('fs-button')).toBeNull();
  });

  it('re-invalidates the map size on fullscreenchange and cleans up the listener on unmount', () => {
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    try {
      const { map } = makeMapWithContainer();
      H.map = map;
      const { unmount } = render(<MapFullscreenControl />);

      act(() => {
        document.dispatchEvent(new Event('fullscreenchange'));
      });
      expect(map.invalidateSize).toHaveBeenCalledTimes(1);

      unmount();
      act(() => {
        document.dispatchEvent(new Event('fullscreenchange'));
      });
      // Listener removed on unmount → no further invalidation.
      expect(map.invalidateSize).toHaveBeenCalledTimes(1);
    } finally {
      rafSpy.mockRestore();
    }
  });
});
