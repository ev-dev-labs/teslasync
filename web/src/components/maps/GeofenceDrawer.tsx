import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';

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
  /** Stroke / fill color for drawn shapes. Default '#22d3ee'. */
  color?: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const ID_KEY = '__teslasync_fence_id';

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
  color = '#22d3ee',
}: GeofenceDrawerProps) {
  const map = useMap();
  const featureGroupRef = useRef<L.FeatureGroup | null>(null);
  // Stable handler refs so option churn doesn't tear down the control.
  const handlersRef = useRef({ onCreate, onEdit, onDelete });
  useEffect(() => {
    handlersRef.current = { onCreate, onEdit, onDelete };
  }, [onCreate, onEdit, onDelete]);

  /* ── Mount the FeatureGroup + Draw control once. ────────────────── */
  useEffect(() => {
    const featureGroup = new L.FeatureGroup();
    featureGroupRef.current = featureGroup;
    map.addLayer(featureGroup);

    const shapeOptions = { color, weight: 2, fillOpacity: 0.15 };
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
        edit: onEdit ? undefined : false,
      },
    });
    map.addControl(drawControl);

    /* ── Event wiring ─────────────────────────────────────────────── */
    const handleCreated = (e: L.LeafletEvent) => {
      const layer = (e as unknown as { layer: TaggedLayer; layerType: string }).layer;
      const layerType = (e as unknown as { layerType: string }).layerType;
      const geom = layerToGeometry(layer, layerType);
      if (!geom) return;
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
    };
    // We intentionally remount only when the structural options change.
  }, [map, modes.join('|'), color, !!onDelete, !!onEdit]);

  /* ── Sync persisted fences into the FeatureGroup. ───────────────── */
  useEffect(() => {
    const featureGroup = featureGroupRef.current;
    if (!featureGroup) return;
    featureGroup.clearLayers();
    for (const f of fences) {
      const layer = fenceToLayer(f, color);
      if (!layer) continue;
      (layer as TaggedLayer)[ID_KEY] = f.id;
      if (f.name) {
        layer.bindTooltip(f.name, { permanent: false, direction: 'top' });
      }
      featureGroup.addLayer(layer);
    }
  }, [fences, color]);

  return null;
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
  const opts = { color, weight: 2, fillOpacity: 0.15 };
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
    return `${name} — ${f.radius.toFixed(0)}m circle around ${f.lat.toFixed(4)}, ${f.lng.toFixed(4)}`;
  }
  if (Array.isArray(f.polygon) && f.polygon.length >= 3) {
    const name = f.name ?? 'Geofence';
    return `${name} — ${f.polygon.length}-vertex polygon`;
  }
  return f.name ?? 'Geofence';
}
