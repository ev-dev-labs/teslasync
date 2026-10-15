/**
 * Unit tests for `<MarkerCluster>`.
 *
 * leaflet + leaflet.markercluster aren't jsdom-friendly, so we mock them.
 * Per vitest hoisting semantics, the fakes live INSIDE the factory and a
 * `vi.hoisted` cell exposes shared state to the test bodies.
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import L from 'leaflet';

interface CapturedMarker {
  latLng: [number, number];
  opts: Record<string, unknown>;
  popup?: string;
  listeners: Record<string, () => void>;
}

interface ClusterOptions {
  iconCreateFunction: (cluster: {
    getAllChildMarkers: () => CapturedMarker[];
    getChildCount: () => number;
  }) => L.DivIcon;
}

const shared = vi.hoisted(() => ({
  map: null as null | {
    layers: unknown[];
    reset: () => void;
  },
  lastGroup: null as null | {
    layers: CapturedMarker[];
    options: ClusterOptions;
    addLayers: ReturnType<typeof vi.fn>;
    clearLayers: ReturnType<typeof vi.fn>;
  },
}));

vi.mock('react-leaflet', () => ({
  useMap: () => shared.map,
}));

vi.mock('leaflet.markercluster', () => ({}));
vi.mock('leaflet.markercluster/dist/MarkerCluster.css', () => ({}));
vi.mock('leaflet.markercluster/dist/MarkerCluster.Default.css', () => ({}));

vi.mock('leaflet', () => {
  class FakeMarker {
    popup: string | undefined;
    listeners: Record<string, () => void> = {};
    constructor(public latLng: [number, number], public opts: Record<string, unknown>) {}
    bindPopup(html: string) {
      this.popup = html;
      return this;
    }
    on(event: string, fn: () => void) {
      this.listeners[event] = fn;
      return this;
    }
  }

  class FakeClusterGroup {
    constructor(public options: ClusterOptions) {}
    layers: FakeMarker[] = [];
    addLayers = vi.fn((arr: FakeMarker[]) => {
      this.layers.push(...arr);
      return this;
    });
    clearLayers = vi.fn(() => {
      this.layers = [];
      return this;
    });
  }

  class FakeMap {
    layers: unknown[] = [];
    addLayer(l: unknown) {
      this.layers.push(l);
      return this;
    }
    removeLayer(l: unknown) {
      this.layers = this.layers.filter((x) => x !== l);
      return this;
    }
    reset() {
      this.layers = [];
    }
  }

  shared.map = new FakeMap();

  const Lmod = {
    marker: (latLng: [number, number], opts: Record<string, unknown>) =>
      new FakeMarker(latLng, opts),
    divIcon: (opts: Record<string, unknown>) => ({ ...opts, options: opts, _divIcon: true }),
    point: (x: number, y: number) => ({ x, y }),
    markerClusterGroup: vi.fn((options: ClusterOptions) => {
      const g = new FakeClusterGroup(options);
      shared.lastGroup = g;
      return g;
    }),
  };
  return { default: Lmod, ...Lmod };
});

import { MarkerCluster } from '../MarkerCluster';

/* ── tests ─────────────────────────────────────────────────────────── */

describe('MarkerCluster', () => {
  beforeEach(() => {
    shared.map?.reset();
    shared.lastGroup = null;
  });

  it('mounts a cluster group on the map and loads the supplied points', () => {
    const points = [
      { id: 'a', lat: 1, lng: 2 },
      { id: 'b', lat: 3, lng: 4, popupHtml: '<b>hi</b>' },
    ];
    render(<MarkerCluster points={points} />);
    expect(shared.map!.layers.length).toBe(1);
    expect(shared.lastGroup).not.toBeNull();
    expect(shared.lastGroup!.addLayers).toHaveBeenCalledTimes(1);
    expect(shared.lastGroup!.layers.length).toBe(2);
    expect(shared.lastGroup!.layers[1].popup).toBe('<b>hi</b>');
  });

  it('skips points with NaN coordinates', () => {
    const points = [
      { id: 'good', lat: 1, lng: 2 },
      { id: 'bad', lat: Number.NaN, lng: 4 },
    ];
    render(<MarkerCluster points={points} />);
    expect(shared.lastGroup!.layers.length).toBe(1);
  });

  it('caps rendered markers at 5000 to avoid the leaflet perf cliff', () => {
    const points = Array.from({ length: 6000 }, (_, i) => ({
      id: i,
      lat: i * 0.0001,
      lng: i * 0.0001,
    }));
    render(<MarkerCluster points={points} />);
    expect(shared.lastGroup!.layers.length).toBe(5000);
  });

  it('forwards marker clicks to onMarkerClick with the original point', () => {
    const onClick = vi.fn();
    const points = [{ id: 'p1', lat: 10, lng: 20 }];
    render(<MarkerCluster points={points} onMarkerClick={onClick} />);
    const marker = shared.lastGroup!.layers[0];
    marker.listeners['click']();
    expect(onClick).toHaveBeenCalledWith(points[0]);
  });

  it.each([
    [1, 'rgba(34, 211, 238, 0.85)'],
    [10, 'rgba(168, 85, 247, 0.85)'],
    [25, 'rgba(251, 191, 36, 0.85)'],
    [100, 'rgba(244, 63, 94, 0.85)'],
  ] as const)('keeps count %i and its paint without a cluster glow', (count, color) => {
    render(<MarkerCluster points={[{ id: 1, lat: 1, lng: 2 }]} />);
    const group = shared.lastGroup!;
    const icon = group.options.iconCreateFunction({
      getAllChildMarkers: () => group.layers,
      getChildCount: () => count,
    });
    const html = document.createElement('div');
    html.innerHTML = String(icon.options.html);
    expect(html.textContent?.trim()).toBe(String(count));
    expect(icon.options.html).toContain(`background:${color}`);
    expect(icon.options.html).toContain('font-weight:700;font-size:12px');
    expect(icon.options.html).not.toMatch(/box-shadow|text-shadow|drop-shadow/);
  });

  it('preserves marker paint, keyboard options and popup lifecycle without a dot glow', () => {
    const first = {
      id: 'first', lat: 10, lng: 20, color: 'var(--semantic-info)',
      ariaLabel: 'First session', popupHtml: '<p>First popup</p>',
    };
    const { rerender, unmount } = render(<MarkerCluster points={[first]} />);
    const group = shared.lastGroup!;
    const marker = group.layers[0];
    expect(marker.latLng).toEqual([10, 20]);
    expect(marker.opts).toMatchObject({
      keyboard: true, alt: 'First session', title: 'First session',
    });
    expect(marker.opts.icon).toMatchObject({
      iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -8],
      html: expect.stringContaining('background:var(--semantic-info)'),
    });
    expect((marker.opts.icon as { html: string }).html).not.toMatch(/box-shadow|text-shadow|drop-shadow/);
    expect(marker.popup).toBe(first.popupHtml);

    rerender(<MarkerCluster points={[{ ...first, id: 'next', popupHtml: '<p>Next popup</p>' }]} />);
    expect(shared.lastGroup).toBe(group);
    expect(group.layers).toHaveLength(1);
    expect(group.layers[0].popup).toBe('<p>Next popup</p>');
    unmount();
    expect(group.layers).toHaveLength(0);
    expect(shared.map!.layers).toHaveLength(0);
  });

  it('preserves caller cluster paint and custom renderer precedence with original children', () => {
    const points = [{ id: 'p', lat: 1, lng: 2 }];
    const getClusterColor = vi.fn(() => 'var(--semantic-info)');
    const { rerender } = render(
      <MarkerCluster points={points} getClusterColor={getClusterColor} />,
    );
    const group = shared.lastGroup!;
    const cluster = {
      getAllChildMarkers: () => group.layers,
      getChildCount: () => 1,
    };
    const icon = group.options.iconCreateFunction(cluster);
    expect(getClusterColor).toHaveBeenCalledWith(points);
    expect(icon.options.html).toContain('background:var(--semantic-info)');
    expect(icon.options.html).not.toContain('box-shadow');

    const customIcon = L.divIcon({ html: '<span>Custom count</span>' });
    const customRenderer = vi.fn(() => customIcon);
    getClusterColor.mockClear();
    rerender(
      <MarkerCluster points={points} getClusterColor={getClusterColor} iconCreateFunction={customRenderer} />,
    );
    expect(shared.lastGroup).toBe(group);
    expect(group.options.iconCreateFunction(cluster)).toBe(customIcon);
    expect(customRenderer).toHaveBeenCalledWith(1, points);
    expect(getClusterColor).not.toHaveBeenCalled();
  });
});
