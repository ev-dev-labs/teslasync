import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import './leafletGlobal';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';
import { fmtNumber, fmtScientificNumber } from '@/lib/numberFormat';
import { resolveMapRendererColor } from '@/lib/colors';
import { EmptyState } from '@/components/feedback/EmptyState';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Modes the drawer offers in its toolbar. */
export type GeofenceMode = 'circle' | 'polygon' | 'rectangle';

/** A drawn or persisted geofence — currently only circles are persisted. */
export interface DrawableGeofence {
  id: string | number;
  /** For circles. */
  lat?: number;
  lng?: number;
  /** Radius in meters (circles). */
  radius?: number;
  /** For polygons / rectangles. Ring of [lat, lng] tuples. */
  polygon?: Array<[number, number]>;
  name?: string;
}

/** New geometry produced by the drawer (no id yet). */
export interface NewGeofence {
  shape: 'circle' | 'polygon' | 'rectangle';
  lat?: number;
  lng?: number;
  radius?: number;
  polygon?: Array<[number, number]>;
}

export interface GeofenceDrawerProps {
  /** Existing geofences to render as editable shapes. */
  fences: DrawableGeofence[];
  /** Called when user finishes drawing a new shape. */
  onCreate: (g: NewGeofence) => void;
  /** Called when user edits an existing shape. */
  onEdit?: (id: string | number, g: NewGeofence) => void;
  /** Called when user deletes a shape via the on-map trash icon. */
  onDelete?: (id: string | number) => void;
  /** Restrict which shapes the user can draw. Default: ['circle']. */
  modes?: GeofenceMode[];
  /** Stroke / fill color for drawn shapes. Defaults to the theme primary role. */
  color?: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const ID_KEY = '__teslasync_fence_id';
const DEFAULT_PAINT = 'var(--theme-primary)';

interface DrawRuntime extends L.Control.Draw {
  _toolbars?: Record<string, {
    _modes: Record<string, { handler: { _shape?: L.Path; _poly?: L.Path } }>;
  }>;
}

function repaintLayer(layer: L.Layer, color: string) {
  if (!(layer instanceof L.Path)) return;
  const options = layer.options as L.PathOptions & {
    original?: L.PathOptions;
    editing?: L.PathOptions;
  };
  // leaflet-draw restores these options when edit mode ends.
  if (options.original) Object.assign(options.original, { color, fillColor: color });
  if (options.editing) Object.assign(options.editing, { color, fillColor: color });
  layer.setStyle({ color, fillColor: color });
}

interface TaggedLayer extends L.Layer {
  [ID_KEY]?: string | number;
}

/**
 * Mounts `leaflet-draw` controls onto the parent map and emits structured
 * callbacks when shapes are created, edited, or deleted.
 *
 * Must be rendered inside a `<MapContainer>`. Re-render with new `fences`
 * to refresh the persisted shapes.
 */
export function GeofenceDrawer({
  fences,
  onCreate,
  onEdit,
  onDelete,
  modes = ['circle'],
  color = DEFAULT_PAINT,
}: GeofenceDrawerProps) {
  const map = useMap();
  const { t } = useTranslation();
  const [paint, setPaint] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const paintRef = useRef<string | null>(null);
  const drawControlRef = useRef<DrawRuntime | null>(null);
  const featureGroupRef = useRef<L.FeatureGroup | null>(null);
  // Stable handler refs so option churn doesn't tear down the control.
  const handlersRef = useRef({ onCreate, onEdit, onDelete });
  useEffect(() => {
    handlersRef.current = { onCreate, onEdit, onDelete };
  }, [onCreate, onEdit, onDelete]);

  useEffect(() => {
    const context = map.getContainer();
    const view = context.ownerDocument.defaultView;
    const resolve = () => {
      const resolved = resolveMapRendererColor(color, context)
        ?? (color === DEFAULT_PAINT ? null : resolveMapRendererColor(DEFAULT_PAINT, context));
      paintRef.current = resolved;
      setPaint(resolved);
    };
    resolve();
    // Observe only theme ancestors, not the resolver's temporary probes.
    const observer = view && new view.MutationObserver((records) => {
      if (records.some(({ target }) => target instanceof Element && target.contains(context))) resolve();
    });
    observer?.observe(context.ownerDocument.documentElement, {
      attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-mode'], subtree: true,
    });
    const media = ['(forced-colors: active)', '(prefers-color-scheme: dark)']
      .map((query) => view?.matchMedia?.(query)).filter((item) => item != null);
    media.forEach((item) => item.addEventListener('change', resolve));
    const timer = view?.setInterval(() => {
      if (paintRef.current === null) resolve();
    }, 1000);
    return () => {
      observer?.disconnect();
      media.forEach((item) => item.removeEventListener('change', resolve));
      if (timer != null) view?.clearInterval(timer);
    };
  }, [map, color, retry]);

  // Availability starts the control; later paint changes never remount it.
  const ready = paint !== null || drawControlRef.current !== null;
  /* ── Mount the FeatureGroup + Draw control once. ────────────────── */
  useEffect(() => {
    if (!ready || paintRef.current === null) return;
    const featureGroup = new L.FeatureGroup();
    featureGroupRef.current = featureGroup;
    map.addLayer(featureGroup);

    const shapeOptions = { color: paintRef.current, fillColor: paintRef.current, weight: 2, fillOpacity: 0.08 };
    const drawOpts: L.Control.DrawOptions = {
      polyline: false,
      marker: false,
      circlemarker: false,
      circle: modes.includes('circle')
        ? { shapeOptions, showRadius: true, metric: true }
        : false,
      polygon: modes.includes('polygon')
        ? { shapeOptions, allowIntersection: false, showArea: true }
        : false,
      rectangle: modes.includes('rectangle')
        ? // leaflet-draw's TS types omit shapeOptions for rectangle; the
          // runtime accepts it. Cast through unknown to satisfy strict TS.
          ({ shapeOptions } as unknown as L.DrawOptions.RectangleOptions)
        : false,
    };

    const drawControl = new L.Control.Draw({
      position: 'topright',
      draw: drawOpts,
      edit: {
        featureGroup,
        remove: !!onDelete,
        edit: onEdit ? {} : false,
      },
    });
    drawControlRef.current = drawControl;
    map.addControl(drawControl);
    // Style the plugin's existing controls without replacing its focus/events.
    drawControl.getContainer()?.classList.add(
      '[&_.leaflet-bar]:!border-[var(--border-default)]',
      '[&_.leaflet-bar]:!shadow-e2',
      '[&_.leaflet-draw-actions_a]:!bg-[var(--surface-2)]',
      '[&_.leaflet-draw-actions_a]:!text-[var(--text-primary)]',
      '[&_a]:!border-[var(--border-default)]',
      '[&_.leaflet-draw-actions_a:hover]:!bg-[var(--surface-3)]',
      '[&_a:focus-visible]:outline',
      '[&_a:focus-visible]:outline-2',
      '[&_a:focus-visible]:outline-offset-2',
      '[&_a:focus-visible]:outline-[var(--focus-ring)]',
      '[&_.leaflet-draw-actions_a]:!text-sm',
      '[&_.leaflet-draw-actions_a]:!font-sans',
      'forced-colors:[&_a]:!bg-[ButtonFace]',
      'forced-colors:[&_a]:!text-[ButtonText]',
      'forced-colors:[&_a]:!border-[ButtonText]',
      'forced-colors:[&_a:focus-visible]:outline-[Highlight]',
    );

    /* ── Event wiring ─────────────────────────────────────────────── */
    const handleCreated = (e: L.LeafletEvent) => {
      const layer = (e as unknown as { layer: TaggedLayer; layerType: string }).layer;
      const layerType = (e as unknown as { layerType: string }).layerType;
      const geom = layerToGeometry(layer, layerType);
      if (!geom || paintRef.current === null) return;
      repaintLayer(layer, paintRef.current);
      featureGroup.addLayer(layer);
      handlersRef.current.onCreate(geom);
    };

    const handleEdited = (e: L.LeafletEvent) => {
      const layers = (e as unknown as { layers: L.LayerGroup }).layers;
      layers.eachLayer((layer) => {
        const tagged = layer as TaggedLayer;
        const id = tagged[ID_KEY];
        if (id == null) return;
        const layerType = inferLayerType(layer);
        const geom = layerToGeometry(layer, layerType);
        if (!geom) return;
        handlersRef.current.onEdit?.(id, geom);
      });
    };

    const handleDeleted = (e: L.LeafletEvent) => {
      const layers = (e as unknown as { layers: L.LayerGroup }).layers;
      layers.eachLayer((layer) => {
        const tagged = layer as TaggedLayer;
        const id = tagged[ID_KEY];
        if (id == null) return;
        handlersRef.current.onDelete?.(id);
      });
    };

    map.on(L.Draw.Event.CREATED, handleCreated);
    map.on(L.Draw.Event.EDITED, handleEdited);
    map.on(L.Draw.Event.DELETED, handleDeleted);

    return () => {
      map.off(L.Draw.Event.CREATED, handleCreated);
      map.off(L.Draw.Event.EDITED, handleEdited);
      map.off(L.Draw.Event.DELETED, handleDeleted);
      map.removeControl(drawControl);
      map.removeLayer(featureGroup);
      featureGroupRef.current = null;
      drawControlRef.current = null;
    };
    // We intentionally remount only when the structural options change.
  }, [map, modes.join('|'), ready, !!onDelete, !!onEdit]);

  useEffect(() => {
    if (paint === null) return;
    const control = drawControlRef.current;
    const shapeOptions = { color: paint, fillColor: paint, weight: 2, fillOpacity: 0.08 };
    control?.setDrawingOptions({
      circle: { shapeOptions }, polygon: { shapeOptions },
      rectangle: { shapeOptions } as unknown as L.DrawOptions.RectangleOptions,
    });
    for (const toolbar of Object.values(control?._toolbars ?? {})) {
      for (const { handler } of Object.values(toolbar._modes)) {
        if (handler._shape) repaintLayer(handler._shape, paint);
        if (handler._poly) repaintLayer(handler._poly, paint);
      }
    }
    featureGroupRef.current?.eachLayer((layer) => repaintLayer(layer, paint));
  }, [paint, ready]);

  /* ── Sync persisted fences into the FeatureGroup. ───────────────── */
  useEffect(() => {
    const featureGroup = featureGroupRef.current;
    if (!featureGroup) return;
    featureGroup.clearLayers();
    for (const f of fences) {
      if (paintRef.current === null) return;
      const layer = fenceToLayer(f, paintRef.current);
      if (!layer) continue;
      (layer as TaggedLayer)[ID_KEY] = f.id;
      if (f.name) {
        layer.bindTooltip(f.name, { permanent: false, direction: 'top' });
      }
      featureGroup.addLayer(layer);
    }
  }, [fences, ready, modes.join('|'), !!onDelete, !!onEdit]);

  return paint === null && typeof document !== 'undefined' ? createPortal(
    <div className="absolute inset-x-2 top-2 z-map-control rounded-shape-lg bg-[var(--surface-1)]">
      <EmptyState
        message={t('systemStatus.sourceUnavailable', { label: t('nav.geofences') })}
        action={{ label: t('common.retry'), onClick: () => setRetry((value) => value + 1) }}
      />
    </div>,
    map.getContainer(),
  ) : null;
}

/* ------------------------------------------------------------------ */
/*  Geometry helpers                                                   */
/* ------------------------------------------------------------------ */

function layerToGeometry(layer: L.Layer, layerType: string): NewGeofence | null {
  if (layerType === 'circle' || layer instanceof L.Circle) {
    const c = layer as L.Circle;
    const ll = c.getLatLng();
    return {
      shape: 'circle',
      lat: ll.lat,
      lng: ll.lng,
      radius: c.getRadius(),
    };
  }
  if (layerType === 'rectangle' || layer instanceof L.Rectangle) {
    const r = layer as L.Rectangle;
    const bounds = r.getBounds();
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    return {
      shape: 'rectangle',
      polygon: [
        [sw.lat, sw.lng],
        [ne.lat, sw.lng],
        [ne.lat, ne.lng],
        [sw.lat, ne.lng],
      ],
    };
  }
  if (layerType === 'polygon' || layer instanceof L.Polygon) {
    const p = layer as L.Polygon;
    const ringRaw = p.getLatLngs();
    const ring = Array.isArray(ringRaw[0])
      ? (ringRaw[0] as L.LatLng[])
      : (ringRaw as L.LatLng[]);
    return {
      shape: 'polygon',
      polygon: ring.map((ll) => [ll.lat, ll.lng] as [number, number]),
    };
  }
  return null;
}

function inferLayerType(layer: L.Layer): string {
  if (layer instanceof L.Circle) return 'circle';
  if (layer instanceof L.Rectangle) return 'rectangle';
  if (layer instanceof L.Polygon) return 'polygon';
  return '';
}

function fenceToLayer(f: DrawableGeofence, color: string): L.Layer | null {
  const opts = { color, weight: 2, fillOpacity: 0.08 };
  if (
    typeof f.lat === 'number' &&
    typeof f.lng === 'number' &&
    typeof f.radius === 'number' &&
    f.radius > 0
  ) {
    return L.circle([f.lat, f.lng], { radius: f.radius, ...opts });
  }
  if (Array.isArray(f.polygon) && f.polygon.length >= 3) {
    return L.polygon(f.polygon, opts);
  }
  return null;
}

/**
 * Build a human-readable accessible description for a fence.
 * Used by callers that surface fences in non-visual UI (lists, screen readers).
 */
export function describeFence(f: DrawableGeofence): string {
  if (
    typeof f.lat === 'number' &&
    typeof f.lng === 'number' &&
    typeof f.radius === 'number'
  ) {
    const name = f.name ?? 'Geofence';
    return `${name} — ${fmtNumber(f.radius)}m circle around ${fmtScientificNumber(f.lat, 4)}, ${fmtScientificNumber(f.lng, 4)}`;
  }
  if (Array.isArray(f.polygon) && f.polygon.length >= 3) {
    const name = f.name ?? 'Geofence';
    return `${name} — ${f.polygon.length}-vertex polygon`;
  }
  return f.name ?? 'Geofence';
}
