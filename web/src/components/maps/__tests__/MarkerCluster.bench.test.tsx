/**
 * `<MarkerCluster>` deterministic-scale test.
 *
 * Asserts that the component can mount large point sets through one clustered
 * GeoJSON source and stable MapLibre layer ids.
 */
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

type SourceProps = {
  id: string;
  data?: { features?: unknown[] };
  children?: ReactNode;
};

type LayerProps = {
  id: string;
};

const shared = vi.hoisted(() => ({
  sources: [] as SourceProps[],
  layers: [] as LayerProps[],
  handlers: new Map<string, unknown>(),
}));

vi.mock('react-map-gl/maplibre', () => ({
  Source: (props: SourceProps) => {
    shared.sources.push(props);
    return props.children ?? null;
  },
  Layer: (props: LayerProps) => {
    shared.layers.push(props);
    return null;
  },
}));

vi.mock('../MapTileLayer', () => ({
  useMap: () => ({
    getMaplibreMap: () => ({
      getMap: () => ({
        on: (event: string, layerId: string, handler: unknown) => {
          shared.handlers.set(`${event}:${layerId}`, handler);
        },
        off: (event: string, layerId: string) => {
          shared.handlers.delete(`${event}:${layerId}`);
        },
        getSource: () => ({ getClusterExpansionZoom: () => Promise.resolve(9) }),
        easeTo: vi.fn(),
        getCanvas: () => ({ style: { cursor: '' } }),
      }),
    }),
  }),
}));

vi.mock('maplibre-gl', () => ({
  default: {
    Popup: class {
      setLngLat() {
        return this;
      }
      setHTML() {
        return this;
      }
      addTo() {
        return this;
      }
      remove() {
        return this;
      }
    },
  },
}));

import { MarkerCluster, type ClusterPoint } from '../MarkerCluster';

function makePoints(n: number): ClusterPoint[] {
  const out: ClusterPoint[] = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = {
      id: i,
      lat: 37.5 + (i % 100) * 0.001,
      lng: -122.4 + Math.floor(i / 100) * 0.001,
    };
  }
  return out;
}

function latestSource(): SourceProps {
  return shared.sources[shared.sources.length - 1]!;
}

describe('MarkerCluster — deterministic scale', () => {
  beforeEach(() => {
    shared.sources = [];
    shared.layers = [];
    shared.handlers.clear();
  });

  it('mounts 1000 points through one clustered source', () => {
    const points = makePoints(1000);
    expect(() => render(<MarkerCluster points={points} />)).not.toThrow();

    expect(shared.sources.length).toBe(1);
    expect(shared.layers.length).toBe(3);
    expect(latestSource().data?.features?.length).toBe(1000);
  });

  it('keeps the same source id when only `points` change', () => {
    const initial = makePoints(500);
    const { rerender } = render(<MarkerCluster points={initial} />);

    const sourceId = latestSource().id;
    const layerIds = shared.layers.map((layer) => layer.id);

    const next = makePoints(750);
    rerender(<MarkerCluster points={next} />);

    expect(latestSource().id).toBe(sourceId);
    expect(shared.layers.slice(-3).map((layer) => layer.id)).toEqual(layerIds);
    expect(latestSource().data?.features?.length).toBe(750);
  });

  it('caps loaded points at 5000 even when 10 000 are supplied', () => {
    const points = makePoints(10_000);
    render(<MarkerCluster points={points} />);
    expect(latestSource().data?.features?.length).toBe(5000);
  });
});
