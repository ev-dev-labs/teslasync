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

type FakeMap = {
  getContainer: () => HTMLElement | null;
  invalidateSize: (...args: unknown[]) => void;
};

type CapturedFsProps = {
  ariaLabelEnter?: string;
  ariaLabelExit?: string;
  className?: string;
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
  TileLayer: ({ url, attribution }: { url: string; attribution: string }) =>
    React.createElement('div', {
      'data-testid': 'tile-layer',
      'data-url': url,
      'data-attribution': attribution,
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

function renderTile(style?: MapStyle) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MapTileLayer style={style} />
    </QueryClientProvider>,
  );
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
  return { container, invalidateSize, map: { getContainer: () => container, invalidateSize } };
}

beforeEach(() => {
  H.map = null;
  H.getMapConfig.mockReset();
  H.fsProps.mockReset();
  // Default provider: free (no key) → the CARTO/OSM/Esri/OpenTopo tiles.
  H.getMapConfig.mockResolvedValue({ provider: 'free', api_key: '' } satisfies MapConfig);
});

afterEach(() => {
  cleanup();
  while (appendedContainers.length) {
    appendedContainers.pop()?.remove();
  }
});

describe('MapTileLayer — free provider tile selection', () => {
  it('defaults to the dark CARTO basemap when no style is supplied', async () => {
    renderTile();
    await settle();
    const el = tile();
    expect(el.getAttribute('data-url')).toContain('basemaps.cartocdn.com/dark_all');
    expect(el.getAttribute('data-attribution')).toContain('CARTO');
  });

  it('selects the Esri World Imagery layer for the satellite style', async () => {
    renderTile('satellite');
    await settle();
    const el = tile();
    expect(el.getAttribute('data-url')).toContain('server.arcgisonline.com');
    expect(el.getAttribute('data-url')).toContain('World_Imagery');
    expect(el.getAttribute('data-attribution')).toContain('Esri');
  });

  it('selects OpenStreetMap tiles for the streets style', async () => {
    renderTile('streets');
    await settle();
    expect(tile().getAttribute('data-url')).toContain('tile.openstreetmap.org');
    expect(tile().getAttribute('data-attribution')).toContain('OpenStreetMap');
  });

  it('selects OpenTopoMap tiles for the terrain style', async () => {
    renderTile('terrain');
    await settle();
    expect(tile().getAttribute('data-url')).toContain('tile.opentopomap.org');
    expect(tile().getAttribute('data-attribution')).toContain('OpenTopoMap');
  });

  it('falls back to the dark tile definition for an unknown style value', async () => {
    // `tiles['aurora']` is undefined → the `|| tiles.dark` guard applies.
    renderTile('aurora' as MapStyle);
    await settle();
    expect(tile().getAttribute('data-url')).toContain('dark_all');
  });
});

describe('MapTileLayer — provider overrides', () => {
  it('uses Azure Maps tiles when the provider is azure and a key is present', async () => {
    H.getMapConfig.mockResolvedValue({ provider: 'azure', api_key: 'AZ-KEY-123' } satisfies MapConfig);
    renderTile('dark');
    await waitFor(() => expect(tile().getAttribute('data-url')).toContain('atlas.microsoft.com'));
    const el = tile();
    expect(el.getAttribute('data-url')).toContain('subscription-key=AZ-KEY-123');
    expect(el.getAttribute('data-url')).toContain('tilesetId=microsoft.base.darkgrey');
    expect(el.getAttribute('data-attribution')).toContain('Azure Maps');
  });

  it('uses Google Maps satellite tiles when the provider is google and a key is present', async () => {
    H.getMapConfig.mockResolvedValue({ provider: 'google', api_key: 'G-KEY-9' } satisfies MapConfig);
    renderTile('satellite');
    await waitFor(() => expect(tile().getAttribute('data-url')).toContain('mt1.google.com'));
    const el = tile();
    expect(el.getAttribute('data-url')).toContain('lyrs=s'); // satellite layer id
    expect(el.getAttribute('data-url')).toContain('key=G-KEY-9');
    expect(el.getAttribute('data-attribution')).toContain('Google Maps');
  });

  it('falls back to free tiles when the provider is azure but the key is missing', async () => {
    H.getMapConfig.mockResolvedValue({ provider: 'azure', api_key: '' } satisfies MapConfig);
    renderTile('dark');
    await settle();
    // The `&& mapConfig.api_key` guard is falsy → we stay on the free basemap.
    expect(tile().getAttribute('data-url')).toContain('cartocdn.com');
    expect(tile().getAttribute('data-url')).not.toContain('atlas.microsoft.com');
  });
});

describe('MapInvalidator', () => {
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
    const props = H.fsProps.mock.calls.at(-1)?.[0] as CapturedFsProps;
    expect(props.ariaLabelEnter).toBe('Grow map');
    expect(props.ariaLabelExit).toBe('Shrink map');
    expect(props.className).toContain('bg-[var(--surface-1)]/90');
    expect(props.targetRef.current).toBe(container);
    // The button surfaces the enter-label so screen readers get a name.
    expect(screen.getByRole('button', { name: 'Grow map' })).toBeInTheDocument();
  });

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
