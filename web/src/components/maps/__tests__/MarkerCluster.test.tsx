/**
 * Unit tests for `<MarkerCluster>`.
 *
 * leaflet + leaflet.markercluster aren't jsdom-friendly, so we mock them.
 * Per vitest hoisting semantics, the fakes live INSIDE the factory and a
 * `vi.hoisted` cell exposes shared state to the test bodies.
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const shared = vi.hoisted(() => ({
  map: null as null | {
    layers: unknown[];
    reset: () => void;
  },
  lastGroup: null as null | {
    layers: Array<{ popup?: string; listeners: Record<string, () => void> }>;
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
    divIcon: (opts: Record<string, unknown>) => ({ ...opts, _divIcon: true }),
    point: (x: number, y: number) => ({ x, y }),
    markerClusterGroup: vi.fn(() => {
      const g = new FakeClusterGroup();
      shared.lastGroup = g as unknown as typeof shared.lastGroup;
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
});
