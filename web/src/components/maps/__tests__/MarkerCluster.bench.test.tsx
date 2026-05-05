/**
 * Phase-46 / Prompt 17 — `<MarkerCluster>` deterministic-scale test.
 *
 * Asserts that the component can mount 1000 points without throwing,
 * routes every point through a single `addLayers` call (the leaflet
 * fast path), and never recreates the cluster group when only the
 * `points` reference is allowed to vary across rerenders.
 *
 * We deliberately avoid wall-clock budget assertions: leaflet is
 * mocked under jsdom (the real plugin can't run there), so any
 * elapsed-ms threshold would measure jsdom overhead rather than
 * cluster performance. Real-world budget verification belongs in
 * Lighthouse / browser perf instrumentation. This test exists to lock
 * in the architectural shape (one cluster group, one chunked-loading
 * `addLayers`, no per-point React work) so a regression that switches
 * back to per-marker rendering surfaces immediately.
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
  groupConstructorCalls: 0,
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
    getAllChildMarkers() {
      return this.layers;
    }
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
      shared.groupConstructorCalls += 1;
      const g = new FakeClusterGroup();
      shared.lastGroup = g as unknown as typeof shared.lastGroup;
      return g;
    }),
  };
  return { default: Lmod, ...Lmod };
});

import { MarkerCluster, type ClusterPoint } from '../MarkerCluster';

function makePoints(n: number): ClusterPoint[] {
  const out: ClusterPoint[] = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = {
      id: i,
      // Spread points across a small grid so the cluster math has
      // realistic density. Values stay far from NaN / 0,0.
      lat: 37.5 + (i % 100) * 0.001,
      lng: -122.4 + Math.floor(i / 100) * 0.001,
    };
  }
  return out;
}

describe('MarkerCluster — deterministic scale', () => {
  beforeEach(() => {
    shared.map?.reset();
    shared.lastGroup = null;
    shared.groupConstructorCalls = 0;
  });

  it('mounts 1000 points through a single addLayers call', () => {
    const points = makePoints(1000);
    expect(() => render(<MarkerCluster points={points} />)).not.toThrow();

    expect(shared.groupConstructorCalls).toBe(1);
    expect(shared.lastGroup).not.toBeNull();
    expect(shared.lastGroup!.addLayers).toHaveBeenCalledTimes(1);
    expect(shared.lastGroup!.layers.length).toBe(1000);

    // Map should hold exactly one layer — the cluster group itself.
    // Per-point markers go inside the group, never on the map directly.
    expect(shared.map!.layers.length).toBe(1);
  });

  it('does not rebuild the cluster group when only `points` change', () => {
    const initial = makePoints(500);
    const { rerender } = render(<MarkerCluster points={initial} />);

    expect(shared.groupConstructorCalls).toBe(1);
    expect(shared.lastGroup!.addLayers).toHaveBeenCalledTimes(1);

    // Swap in a different points array; the group itself must persist.
    const next = makePoints(750);
    rerender(<MarkerCluster points={next} />);

    expect(shared.groupConstructorCalls).toBe(1);
    expect(shared.lastGroup!.clearLayers).toHaveBeenCalled();
    expect(shared.lastGroup!.addLayers).toHaveBeenCalledTimes(2);
    expect(shared.lastGroup!.layers.length).toBe(750);
  });

  it('caps loaded markers at 5000 even when 10 000 are supplied', () => {
    const points = makePoints(10_000);
    render(<MarkerCluster points={points} />);
    expect(shared.lastGroup!.layers.length).toBe(5000);
  });
});
