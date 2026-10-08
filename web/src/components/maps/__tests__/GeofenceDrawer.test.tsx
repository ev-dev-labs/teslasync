/**
 * Unit tests for `<GeofenceDrawer>`.
 *
 * leaflet + leaflet-draw are jsdom-hostile; we mock both. To work around
 * vitest's `vi.mock` hoisting (which runs the factory BEFORE the test
 * module's top-level statements), all fake classes are defined inside the
 * factory itself, and shared state (the fake map / module handle) is
 * exposed via `vi.hoisted` so the test bodies can introspect it.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const shared = vi.hoisted(() => {
  return {
    map: null as null | {
      controls: unknown[];
      layers: unknown[];
      reset: () => void;
      emit: (event: string, payload?: unknown) => void;
      getContainer: () => HTMLElement;
    },
    L: null as unknown as Record<string, unknown> | null,
    resolve: vi.fn<(input: string, context: HTMLElement) => string | null>(),
  };
});

vi.mock('@/lib/colors', () => ({ resolveMapRendererColor: shared.resolve }));

vi.mock('react-leaflet', () => ({
  useMap: () => shared.map,
}));

vi.mock('leaflet-draw', () => ({}));
vi.mock('leaflet-draw/dist/leaflet.draw.css', () => ({}));

vi.mock('leaflet', () => {
  type Listener = (...args: unknown[]) => void;

  class FakeLayer {
    bindTooltip = vi.fn(() => this);
    options: { color?: string; fillColor?: string; original?: { color?: string }; editing?: { color?: string } } = {};
    setStyle = vi.fn((options: { color?: string; fillColor?: string }) => {
      Object.assign(this.options, options);
      if ('opts' in this) Object.assign(this.opts as object, options);
      return this;
    });
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
    eachLayer(fn: (layer: unknown) => void) {
      this.layers.forEach(fn);
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
    container = document.createElement('div');
    _toolbars = { draw: { _modes: { circle: { handler: { _shape: new FakeLayer(), _poly: new FakeLayer() } } } } };
    constructor(public opts: unknown) {}
    setDrawingOptions(options: Record<string, unknown>) {
      const opts = this.opts as { draw: Record<string, unknown> };
      for (const [mode, value] of Object.entries(options)) {
        if (opts.draw[mode] !== false) Object.assign(opts.draw[mode] as object, value);
      }
    }
    getContainer() {
      return this.container;
    }
  }

  class FakeMap {
    container = document.createElement('div');
    getContainer() {
      return this.container;
    }
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
      document.body.appendChild(this.container);
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
    Path: FakeLayer,
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
    shared.resolve.mockReset();
    shared.resolve.mockImplementation((input) =>
      input === 'var(--theme-primary)' ? 'rgb(145, 180, 210)' : input,
    );
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
    ).toBe('Home — 100.00m circle around 37.7749, -122.4194');
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

  it('uses theme geometry and restrained plugin chrome without enabling mutations', () => {
    render(
      <GeofenceDrawer
        fences={[{ id: 0, name: 'Origin', lat: 0, lng: 0, radius: 250 }]}
        onCreate={() => {}}
      />,
    );
    expect(shared.map!.controls[0]).toMatchObject({
      opts: {
        draw: {
          circle: {
            shapeOptions: { color: 'rgb(145, 180, 210)', weight: 2, fillOpacity: 0.08 },
            metric: true,
            showRadius: true,
          },
          polygon: false,
          rectangle: false,
        },
        edit: { remove: false, edit: false },
      },
      container: expect.any(HTMLDivElement),
    });
    const control = shared.map!.controls[0];
    if (!(typeof control === 'object' && control !== null && 'container' in control)) {
      throw new Error('Missing control container');
    }
    expect(control.container).toBeInstanceOf(HTMLDivElement);
    if (!(control.container instanceof HTMLDivElement)) throw new Error('Invalid container');
    expect(control.container.classList).toContain('[&_.leaflet-draw-actions_a]:!bg-[var(--surface-2)]');
    expect(control.container.classList).toContain('forced-colors:[&_a]:!text-[ButtonText]');
    expect(control.container.classList).toContain('[&_a:focus-visible]:outline-offset-2');
    expect(shared.map!.layers[0]).toMatchObject({
      layers: [
        {
          center: [0, 0],
          opts: { radius: 250, color: 'rgb(145, 180, 210)', fillOpacity: 0.08 },
          __teslasync_fence_id: 0,
        },
      ],
    });
  });

  it('retains explicit colors, SI geometry, current callbacks and cleanup', () => {
    const onCreate = vi.fn();
    const nextCreate = vi.fn();
    const onDelete = vi.fn();
    const fences = [{ id: 0, lat: 0, lng: 0, radius: 125 }];
    const { rerender, unmount } = render(
      <GeofenceDrawer fences={fences} color="#83464e" onCreate={onCreate} onDelete={onDelete} />,
    );
    const control = shared.map!.controls[0];
    expect(control).toMatchObject({
      opts: { draw: { circle: { shapeOptions: { color: '#83464e' } } }, edit: { remove: true } },
    });
    rerender(
      <GeofenceDrawer fences={fences} color="#83464e" onCreate={nextCreate} onDelete={onDelete} />,
    );
    expect(shared.map!.controls[0]).toBe(control);
    const layer = { __teslasync_fence_id: 0, getLatLng: () => ({ lat: 0, lng: 0 }), getRadius: () => 125 };
    shared.map!.emit('draw:created', { layerType: 'circle', layer });
    expect(nextCreate).toHaveBeenCalledWith({ shape: 'circle', lat: 0, lng: 0, radius: 125 });
    expect(onCreate).not.toHaveBeenCalled();
    shared.map!.emit('draw:deleted', { layers: { eachLayer: (fn: (value: unknown) => void) => fn(layer) } });
    expect(onDelete).toHaveBeenCalledWith(0);
    unmount();
    expect(shared.map!.controls).toHaveLength(0);
    expect(shared.map!.layers).toHaveLength(0);
    shared.map!.emit('draw:created', { layerType: 'circle', layer });
    expect(nextCreate).toHaveBeenCalledTimes(1);
  });

  it('resolves caller paint in the actual attached context and repaints without resetting drafts or IDs', async () => {
    const onCreate = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const fences = [{ id: 0, lat: 1, lng: 2, radius: 125 }];
    const { rerender } = render(
      <GeofenceDrawer fences={fences} onCreate={onCreate} onEdit={onEdit} onDelete={onDelete} />,
    );
    const control = shared.map!.controls[0] as {
      container: HTMLElement;
      _toolbars: { draw: { _modes: { circle: { handler: { _shape: { setStyle: ReturnType<typeof vi.fn> } } } } } };
    };
    const group = shared.map!.layers[0] as { layers: Array<{ options: { original?: { color?: string }; editing?: { color?: string } } }> };
    const layer = group.layers[0];
    layer.options.original = { color: 'old' };
    layer.options.editing = { color: 'old' };
    const focus = document.createElement('a');
    focus.href = '#';
    control.container.appendChild(focus);
    document.body.appendChild(control.container);
    focus.focus();
    shared.resolve.mockReturnValue('rgb(56, 94, 126)');
    act(() => { shared.map!.getContainer().classList.add('light'); });
    await waitFor(() => expect(layer.options.original?.color).toBe('rgb(56, 94, 126)'));
    expect(layer.options.editing?.color).toBe('rgb(56, 94, 126)');
    expect(shared.map!.controls[0]).toBe(control);
    expect(shared.map!.layers[0]).toBe(group);
    expect(group.layers[0]).toBe(layer);
    expect(document.activeElement).toBe(focus);
    expect(control._toolbars.draw._modes.circle.handler._shape.setStyle).toHaveBeenLastCalledWith({
      color: 'rgb(56, 94, 126)', fillColor: 'rgb(56, 94, 126)',
    });
    rerender(<GeofenceDrawer fences={fences} color="var(--custom)" onCreate={onCreate} onEdit={onEdit} onDelete={onDelete} />);
    expect(shared.resolve).toHaveBeenCalledWith('var(--custom)', shared.map!.getContainer());
    expect(shared.map!.controls[0]).toBe(control);
    expect(group.layers[0]).toBe(layer);
    expect(onCreate).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    control.container.remove();
  });

  it('uses only the declared default after invalid caller paint and exposes unresolved retry', () => {
    shared.resolve.mockImplementation((input) =>
      input === 'var(--theme-primary)' ? 'rgb(145, 180, 210)' : null,
    );
    const { unmount } = render(<GeofenceDrawer fences={[]} color="invalid" onCreate={() => {}} />);
    expect(shared.map!.controls[0]).toMatchObject({
      opts: { draw: { circle: { shapeOptions: { color: 'rgb(145, 180, 210)' } } } },
    });
    unmount();
    shared.resolve.mockReturnValue(null);
    const onCreate = vi.fn();
    render(<GeofenceDrawer fences={[{ id: 1, lat: 0, lng: 0, radius: 5 }]} onCreate={onCreate} />);
    expect(shared.map!.controls).toHaveLength(0);
    expect(shared.map!.layers).toHaveLength(0);
    expect(screen.getByRole('status')).toBeInTheDocument();
    shared.resolve.mockReturnValue('rgb(56, 94, 126)');
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(shared.map!.controls).toHaveLength(1);
    expect(shared.map!.layers[0]).toMatchObject({ layers: [{ __teslasync_fence_id: 1 }] });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('retains existing layers through unresolved paint and only recreates controls for structural options', () => {
    const onCreate = vi.fn();
    const fences = [{ id: 'retained', lat: 0, lng: 0, radius: 10 }];
    const { rerender } = render(<GeofenceDrawer fences={fences} onCreate={onCreate} />);
    const control = shared.map!.controls[0];
    const group = shared.map!.layers[0];
    shared.resolve.mockReturnValue(null);
    rerender(<GeofenceDrawer fences={fences} color="var(--missing)" onCreate={onCreate} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(shared.map!.controls[0]).toBe(control);
    expect(shared.map!.layers[0]).toBe(group);
    shared.map!.emit('draw:created', {
      layerType: 'circle',
      layer: { getLatLng: () => ({ lat: 0, lng: 0 }), getRadius: () => 10 },
    });
    expect(onCreate).not.toHaveBeenCalled();
    shared.resolve.mockReturnValue('rgb(131, 70, 78)');
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(shared.map!.controls[0]).toBe(control);
    expect(shared.map!.layers[0]).toBe(group);
    rerender(
      <GeofenceDrawer fences={fences} color="#83464e" modes={['polygon', 'rectangle']} onCreate={onCreate} onEdit={() => {}} />,
    );
    expect(shared.map!.controls[0]).not.toBe(control);
    expect(shared.map!.controls[0]).toMatchObject({
      opts: {
        draw: { circle: false, polygon: { allowIntersection: false, showArea: true }, rectangle: { shapeOptions: { weight: 2, fillOpacity: 0.08 } } },
        edit: { remove: false },
      },
    });
    expect(shared.map!.layers[0]).toMatchObject({ layers: [{ __teslasync_fence_id: 'retained' }] });
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('repaints draft and existing paths on forced-color media changes without callbacks', () => {
    const listeners = new Map<string, () => void>();
    const remove = vi.fn();
    const descriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    const media = vi.fn((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: (_type: string, handler: EventListenerOrEventListenerObject) => listeners.set(query, handler as () => void),
      removeEventListener: remove,
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(() => true),
    }));
    // jsdom has no matchMedia; provide only this test's browser API surface.
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: media });
    const onCreate = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    let unmount = () => {};
    try {
      ({ unmount } = render(
        <GeofenceDrawer fences={[{ id: 1, lat: 0, lng: 0, radius: 10 }]} onCreate={onCreate} onEdit={onEdit} onDelete={onDelete} />,
      ));
      const control = shared.map!.controls[0];
      const group = shared.map!.layers[0];
      expect(media).toHaveBeenCalledWith('(forced-colors: active)');
      expect(media).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
      for (const [query, paint] of [
        ['(forced-colors: active)', 'rgb(55, 0, 110)'],
        ['(prefers-color-scheme: dark)', 'rgb(56, 94, 126)'],
      ]) {
        const listener = listeners.get(query);
        if (!listener) throw new Error(`Missing media subscription: ${query}`);
        shared.resolve.mockReturnValue(paint);
        act(() => listener());
        expect(shared.map!.controls[0]).toBe(control);
        expect(shared.map!.layers[0]).toBe(group);
        expect(group).toMatchObject({
          layers: [{ __teslasync_fence_id: 1, opts: { color: paint, fillColor: paint } }],
        });
        expect(control).toMatchObject({
          opts: { draw: { circle: { shapeOptions: { color: paint } } } },
          _toolbars: { draw: { _modes: { circle: { handler: {
            _shape: { options: { color: paint, fillColor: paint } },
            _poly: { options: { color: paint, fillColor: paint } },
          } } } } },
        });
      }
      expect(onCreate).not.toHaveBeenCalled();
      expect(onEdit).not.toHaveBeenCalled();
      expect(onDelete).not.toHaveBeenCalled();
      unmount();
      expect(remove).toHaveBeenCalledTimes(2);
      for (const listener of listeners.values()) {
        expect(remove).toHaveBeenCalledWith('change', listener);
      }
    } finally {
      unmount();
      if (descriptor) Object.defineProperty(window, 'matchMedia', descriptor);
      else Reflect.deleteProperty(window, 'matchMedia');
    }
  });
});
