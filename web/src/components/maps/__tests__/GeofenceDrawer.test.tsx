/**
 * Unit tests for `<GeofenceDrawer>`.
 *
 * leaflet + leaflet-draw are jsdom-hostile; we mock both. To work around
 * vitest's `vi.mock` hoisting (which runs the factory BEFORE the test
 * module's top-level statements), all fake classes are defined inside the
 * factory itself, and shared state (the fake map / module handle) is
 * exposed via `vi.hoisted` so the test bodies can introspect it.
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const shared = vi.hoisted(() => {
  return {
    map: null as null | {
      controls: unknown[];
      layers: unknown[];
      reset: () => void;
      emit: (event: string, payload?: unknown) => void;
    },
    L: null as unknown as Record<string, unknown> | null,
  };
});

vi.mock('react-leaflet', () => ({
  useMap: () => shared.map,
}));

vi.mock('leaflet-draw', () => ({}));
vi.mock('leaflet-draw/dist/leaflet.draw.css', () => ({}));

vi.mock('leaflet', () => {
  type Listener = (...args: unknown[]) => void;

  class FakeLayer {
    bindTooltip = vi.fn(() => this);
  }
  class FakeFeatureGroup extends FakeLayer {
    layers: unknown[] = [];
    clearLayers() {
      this.layers = [];
      return this;
    }
    addLayer(l: unknown) {
      this.layers.push(l);
      return this;
    }
  }
  class FakeCircle extends FakeLayer {
    constructor(
      public center: [number, number],
      public opts: { radius: number; color?: string },
    ) {
      super();
    }
    getLatLng() {
      return { lat: this.center[0], lng: this.center[1] };
    }
    getRadius() {
      return this.opts.radius;
    }
  }
  class FakeRectangle extends FakeLayer {}
  class FakePolygon extends FakeLayer {
    constructor(public coords: Array<[number, number]>) {
      super();
    }
    getLatLngs() {
      return this.coords.map(([lat, lng]) => ({ lat, lng }));
    }
  }
  class FakeDrawControl {
    constructor(public opts: unknown) {}
  }

  class FakeMap {
    listeners = new Map<string, Listener[]>();
    controls: unknown[] = [];
    layers: unknown[] = [];
    on(event: string, fn: Listener) {
      const arr = this.listeners.get(event) ?? [];
      arr.push(fn);
      this.listeners.set(event, arr);
      return this;
    }
    off(event: string, fn: Listener) {
      const arr = this.listeners.get(event) ?? [];
      this.listeners.set(
        event,
        arr.filter((l) => l !== fn),
      );
      return this;
    }
    emit(event: string, payload?: unknown) {
      for (const fn of this.listeners.get(event) ?? []) fn(payload);
    }
    reset() {
      this.listeners.clear();
      this.controls = [];
      this.layers = [];
    }
    addControl(c: unknown) {
      this.controls.push(c);
      return this;
    }
    removeControl(c: unknown) {
      this.controls = this.controls.filter((x) => x !== c);
      return this;
    }
    addLayer(l: unknown) {
      this.layers.push(l);
      return this;
    }
    removeLayer(l: unknown) {
      this.layers = this.layers.filter((x) => x !== l);
      return this;
    }
  }

  shared.map = new FakeMap();

  const Lmod = {
    Layer: FakeLayer,
    Circle: FakeCircle,
    Rectangle: FakeRectangle,
    Polygon: FakePolygon,
    FeatureGroup: FakeFeatureGroup,
    circle: (center: [number, number], opts: { radius: number }) =>
      new FakeCircle(center, opts),
    polygon: (coords: Array<[number, number]>) => new FakePolygon(coords),
    Control: { Draw: FakeDrawControl },
    Draw: { Event: { CREATED: 'draw:created', EDITED: 'draw:edited', DELETED: 'draw:deleted' } },
    _classes: { FakeCircle, FakeFeatureGroup, FakeDrawControl },
  };
  shared.L = Lmod;
  return { default: Lmod, ...Lmod };
});

import { GeofenceDrawer, describeFence } from '../GeofenceDrawer';

/* ── tests ─────────────────────────────────────────────────────────── */

describe('GeofenceDrawer', () => {
  beforeEach(() => {
    shared.map?.reset();
  });

  it('mounts a draw control and a feature group on the parent map', () => {
    render(
      <GeofenceDrawer
        fences={[]}
        onCreate={() => {}}
        modes={['circle', 'rectangle']}
      />,
    );
    expect(shared.map!.controls.length).toBe(1);
    expect(shared.map!.layers.length).toBe(1);
    const FakeDrawControl = (shared.L as unknown as { _classes: { FakeDrawControl: new (...a: unknown[]) => unknown } })._classes.FakeDrawControl;
    expect(shared.map!.controls[0]).toBeInstanceOf(FakeDrawControl);
  });

  it('emits onCreate with circle geometry when draw:created fires for a circle', () => {
    const onCreate = vi.fn();
    render(<GeofenceDrawer fences={[]} onCreate={onCreate} />);
    const FakeCircle = (shared.L as unknown as { _classes: { FakeCircle: new (a: [number, number], b: { radius: number }) => unknown } })._classes.FakeCircle;
    const circle = new FakeCircle([37.7749, -122.4194], { radius: 250 });
    shared.map!.emit('draw:created', { layerType: 'circle', layer: circle });
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith({
      shape: 'circle',
      lat: 37.7749,
      lng: -122.4194,
      radius: 250,
    });
  });

  it('emits onEdit with the persisted id when draw:edited fires', () => {
    const onEdit = vi.fn();
    render(
      <GeofenceDrawer
        fences={[{ id: 'home', lat: 1, lng: 2, radius: 100 }]}
        onCreate={() => {}}
        onEdit={onEdit}
      />,
    );
    const FakeCircle = (shared.L as unknown as { _classes: { FakeCircle: new (a: [number, number], b: { radius: number }) => unknown } })._classes.FakeCircle;
    const circle = new FakeCircle([1.5, 2.5], { radius: 150 });
    (circle as unknown as Record<string, unknown>)['__teslasync_fence_id'] = 'home';
    const layers = {
      eachLayer: (fn: (l: unknown) => void) => fn(circle),
    };
    shared.map!.emit('draw:edited', { layers });
    expect(onEdit).toHaveBeenCalledWith('home', {
      shape: 'circle',
      lat: 1.5,
      lng: 2.5,
      radius: 150,
    });
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
