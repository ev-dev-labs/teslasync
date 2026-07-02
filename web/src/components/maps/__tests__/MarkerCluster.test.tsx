/**
 * Unit tests for `<MarkerCluster>`.
 *
 * MapLibre GL is not jsdom-friendly, so the declarative Source/Layer bridge
 * and imperative map facade are mocked.
 */
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

type SourceProps = {
  id: string;
  type: string;
  cluster?: boolean;
  clusterRadius?: number;
  clusterMaxZoom?: number;
  data?: {
    features?: Array<{
      properties?: Record<string, unknown>;
      geometry?: { coordinates?: unknown[] };
    }>;
  };
  children?: ReactNode;
};

type LayerProps = {
  id: string;
  type: string;
  filter?: unknown[];
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
};

type MapEventHandler = (event: {
  features?: Array<{
    properties?: Record<string, unknown>;
    geometry?: { type: 'Point'; coordinates: [number, number] };
  }>;
}) => void;

const shared = vi.hoisted(() => ({
  sources: [] as SourceProps[],
  layers: [] as LayerProps[],
  handlers: new Map<string, MapEventHandler>(),
  canvas: { style: { cursor: '' } },
  easeTo: vi.fn(),
  getClusterExpansionZoom: vi.fn(() => Promise.resolve(9)),
  lastPopup: null as null | {
    lngLat?: [number, number];
    html?: string;
    addTo: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  },
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
        on: (event: string, layerId: string, handler: MapEventHandler) => {
          shared.handlers.set(`${event}:${layerId}`, handler);
        },
        off: (event: string, layerId: string) => {
          shared.handlers.delete(`${event}:${layerId}`);
        },
        getSource: () => ({
          getClusterExpansionZoom: shared.getClusterExpansionZoom,
        }),
        easeTo: shared.easeTo,
        getCanvas: () => shared.canvas,
      }),
    }),
  }),
}));

vi.mock('maplibre-gl', () => {
  class FakePopup {
    lngLat?: [number, number];
    html?: string;
    addTo = vi.fn(() => this);
    remove = vi.fn(() => this);
    constructor() {
      shared.lastPopup = this;
    }
    setLngLat(lngLat: [number, number]) {
      this.lngLat = lngLat;
      return this;
    }
    setHTML(html: string) {
      this.html = html;
      return this;
    }
  }
  return { default: { Popup: FakePopup } };
});

import { MarkerCluster } from '../MarkerCluster';

function latestSource(): SourceProps {
  return shared.sources[shared.sources.length - 1]!;
}

function pointLayerId(): string {
  return shared.layers.find((layer) => layer.id.endsWith('-points'))!.id;
}

describe('MarkerCluster', () => {
  beforeEach(() => {
    shared.sources = [];
    shared.layers = [];
    shared.handlers.clear();
    shared.canvas.style.cursor = '';
    shared.easeTo.mockClear();
    shared.getClusterExpansionZoom.mockClear();
    shared.lastPopup = null;
  });

  it('mounts a clustered GeoJSON source and loads the supplied points', () => {
    const points = [
      { id: 'a', lat: 1, lng: 2 },
      { id: 'b', lat: 3, lng: 4, popupHtml: '<b>hi</b>' },
    ];
    render(<MarkerCluster points={points} />);

    expect(latestSource().cluster).toBe(true);
    expect(shared.layers.length).toBe(3);
    expect(latestSource().data?.features?.length).toBe(2);
    expect(latestSource().data?.features?.[1]?.properties?.popupHtml).toBe('<b>hi</b>');
  });

  it('skips points with NaN coordinates', () => {
    const points = [
      { id: 'good', lat: 1, lng: 2 },
      { id: 'bad', lat: Number.NaN, lng: 4 },
    ];
    render(<MarkerCluster points={points} />);
    expect(latestSource().data?.features?.length).toBe(1);
  });

  it('caps rendered points at 5000 to avoid the map perf cliff', () => {
    const points = Array.from({ length: 6000 }, (_, i) => ({
      id: i,
      lat: i * 0.0001,
      lng: i * 0.0001,
    }));
    render(<MarkerCluster points={points} />);
    expect(latestSource().data?.features?.length).toBe(5000);
  });

  it('forwards marker clicks to onMarkerClick with the original point and opens a popup', () => {
    const onClick = vi.fn();
    const points = [{ id: 'p1', lat: 10, lng: 20, popupHtml: '<b>p1</b>' }];
    render(<MarkerCluster points={points} onMarkerClick={onClick} />);

    shared.handlers.get(`click:${pointLayerId()}`)?.({
      features: [{ properties: { idx: 0 }, geometry: { type: 'Point', coordinates: [20, 10] } }],
    });

    expect(onClick).toHaveBeenCalledWith(points[0]);
    expect(shared.lastPopup?.lngLat).toEqual([20, 10]);
    expect(shared.lastPopup?.html).toBe('<b>p1</b>');
  });
});
